import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openHuddleThread } from '../huddleThread.ts';

function fixture() {
  let call = { status: 'connected' as const, channelId: 'C1', roomId: 'R1' };
  const actions: unknown[] = [];
  const dependencies = {
    getCall: () => call,
    getCachedThread: (_roomId: string): unknown => undefined,
    getRoom: async (roomId: string): Promise<unknown> => {
      actions.push(['info', roomId]);
      return { channels: ['C1'], canvas_thread_ts: '1234567890.000001' };
    },
    showThread: async (target: unknown) => {
      actions.push(['show', target]);
    },
    focusSlack: () => {
      actions.push('focus');
    },
  };
  return {
    dependencies,
    actions,
    replaceCall: () => {
      call = { ...call, roomId: 'R2' };
    },
  };
}

describe('openHuddleThread', () => {
  it('opens Slack’s cached huddle thread without an API call, then focuses Slack', async () => {
    const f = fixture();
    f.dependencies.getCachedThread = () => ({ channelId: 'D2', ts: '1234567890.000002' });
    await openHuddleThread(f.dependencies);
    assert.deepEqual(f.actions, [['show', { channelId: 'D2', threadTs: '1234567890.000002' }], 'focus']);
  });

  it('looks up the room’s associated thread when the native huddle client has not cached it', async () => {
    const f = fixture();
    await openHuddleThread(f.dependencies);
    assert.deepEqual(f.actions, [
      ['info', 'R1'],
      ['show', { channelId: 'C1', threadTs: '1234567890.000001' }],
      'focus',
    ]);
  });

  it('does not navigate to an old huddle after the call changes during lookup', async () => {
    const f = fixture();
    const getRoom = f.dependencies.getRoom;
    f.dependencies.getRoom = async (id) => {
      const room = await getRoom(id);
      f.replaceCall();
      return room;
    };
    await openHuddleThread(f.dependencies);
    assert.deepEqual(f.actions, [['info', 'R1']]);
  });

  it('reports missing or placeholder threads instead of opening an unrelated conversation', async () => {
    for (const room of [{}, { canvas_thread_ts: '0000000000.000000' }]) {
      const f = fixture();
      f.dependencies.getRoom = async () => room;
      await assert.rejects(openHuddleThread(f.dependencies), /not available yet/);
      assert.deepEqual(f.actions, []);
    }
  });

  it('leaves focus alone when Slack cannot open the thread', async () => {
    const f = fixture();
    f.dependencies.showThread = async () => {
      throw new Error('navigation failed');
    };
    await assert.rejects(openHuddleThread(f.dependencies), /navigation failed/);
    assert.deepEqual(f.actions, [['info', 'R1']]);
  });
});
