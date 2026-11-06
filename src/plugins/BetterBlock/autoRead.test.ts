import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { BlockedDmReader } from './autoRead.ts';

function fixture(t: TestContext) {
  const state: any = {
    bootData: { user_id: 'USELF', enterprise_id: 'E1' },
    channels: Object.create({ D1: { is_im: true, user: 'UBLOCKED' } }),
    channelLatests: {},
    channelCursors: {},
    messages: {},
  };
  const blocked = new Set(['UBLOCKED']);
  let active = true;
  const calls: { id: string; ts: string }[] = [];
  const errors: unknown[] = [];
  let mark = async (_id: string, _ts: string) => {};
  const reader = new BlockedDmReader({
    getState: () => state,
    getBlocked: () => blocked,
    isActive: () => active,
    markRead: async (id, ts) => {
      calls.push({ id, ts });
      await mark(id, ts);
    },
    onError: (error) => errors.push(error),
  });
  t.after(() => reader.stop());
  return {
    state,
    blocked,
    calls,
    errors,
    reader,
    setActive: (value: boolean) => {
      active = value;
    },
    setMark: (fn: typeof mark) => {
      mark = fn;
    },
  };
}
const message = (ts: string, overrides = {}) => ({
  type: 'message',
  channel: 'D1',
  user: 'UBLOCKED',
  ts,
  ...overrides,
});

test('auto-read covers inherited DM channels on startup and skips already-read cursors', async (t) => {
  const f = fixture(t);
  f.state.channelLatests.D1 = '100.000002';
  f.state.channelCursors.D1 = '100.000001';
  await f.reader.flush();
  await f.reader.flush();
  assert.deepEqual(f.calls, [{ id: 'D1', ts: '100.000002' }]);
  f.state.channelLatests.D1 = '100.000003';
  f.state.channelCursors.D1 = '100.000004';
  await f.reader.flush();
  assert.equal(f.calls.length, 1);
});

test('auto-read coalesces bursts, serializes requests and never moves a read cursor backwards', async (t) => {
  const f = fixture(t);
  f.reader.onMessage(message('100.000001'));
  f.reader.onMessage(message('100.000003'));
  f.reader.onMessage(message('100.000002'));
  let release!: () => void;
  f.setMark(async () => {
    if (f.calls.length === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
  });
  const pending = f.reader.flush();
  assert.deepEqual(f.calls, [{ id: 'D1', ts: '100.000003' }]);
  f.reader.onMessage(message('100.000002'));
  f.reader.onMessage(message('100.000004'));
  await f.reader.flush();
  assert.equal(f.calls.length, 1);
  release();
  await pending;
  assert.deepEqual(
    f.calls.map((call) => call.ts),
    ['100.000003', '100.000004'],
  );
  f.reader.onMessage(message('100.000001'));
  await f.reader.flush();
  assert.equal(f.calls.length, 2);
});

test('auto-read leaves allowed DMs, channels, group DMs, huddles and edit/delete events alone', async (t) => {
  const f = fixture(t);
  f.state.channels.D2 = { is_im: true, user: 'UOTHER' };
  f.state.channels.C1 = { is_im: false, user: 'UBLOCKED' };
  f.state.channels.G1 = { is_mpim: true, members: ['UBLOCKED'] };
  for (const event of [
    message('100.000001', { channel: 'D2' }),
    message('100.000002', { channel: 'C1' }),
    message('100.000003', { channel: 'G1' }),
    message('100.000004', { subtype: 'huddle_thread' }),
    message('100.000005', { subtype: 'message_changed' }),
    message('100.000006', { subtype: 'message_deleted' }),
    message('100.000007', { user: 'USELF' }),
    message('invalid'),
  ])
    f.reader.onMessage(event);
  await f.reader.flush();
  assert.deepEqual(f.calls, []);
  f.state.channelLatests.D1 = '100.000008';
  f.state.messages.D1 = { '100.000008': message('100.000008', { subtype: 'huddle_thread' }) };
  await f.reader.flush();
  assert.deepEqual(f.calls, []);
});

test('queued auto-reads recheck blocking, account scope and plugin lifetime', async (t) => {
  for (const change of ['unblock', 'account', 'disable', 'stop']) {
    const f = fixture(t);
    f.reader.onMessage(message('100.000001'));
    if (change === 'unblock') f.blocked.clear();
    if (change === 'account') f.state.bootData = { user_id: 'UDIFFERENT', enterprise_id: 'E2' };
    if (change === 'disable') f.setActive(false);
    if (change === 'stop') f.reader.stop();
    await f.reader.flush();
    assert.deepEqual(f.calls, [], change);
  }
});

test('failed auto-reads can retry and channel hydration is observed without a visible DM', async (t) => {
  const f = fixture(t);
  f.setMark(async () => {
    throw new Error('offline');
  });
  f.reader.onMessage(message('100.000001'));
  await f.reader.flush();
  assert.equal(f.errors.length, 1);
  f.setMark(async () => {});
  f.reader.onMessage(message('100.000001'));
  await f.reader.flush();
  assert.equal(f.calls.length, 2);
  f.state.channels.D3 = { is_im: true, user: 'UBLOCKED' };
  f.state.channelLatests = { D3: '100.000002' };
  f.reader.observe();
  await f.reader.flush();
  assert.deepEqual(f.calls.at(-1), { id: 'D3', ts: '100.000002' });
});
