import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inHistory, withLiveThread, withTimestamps, type HistoryMessage } from './messageHistory.ts';

test('inHistory: channel view hides thread replies unless they are the parent or a broadcast', () => {
  const reply: HistoryMessage = { ts: '2', thread_ts: '1' };
  const parent: HistoryMessage = { ts: '1', thread_ts: '1' };
  const broadcast: HistoryMessage = { ts: '3', thread_ts: '1', subtype: 'thread_broadcast' };
  const top: HistoryMessage = { ts: '4' };

  assert.equal(inHistory(reply, undefined), false);
  assert.equal(inHistory(parent, undefined), true);
  assert.equal(inHistory(broadcast, undefined), true);
  assert.equal(inHistory(top, undefined), true);
});

test('inHistory: thread view only includes replies to that thread', () => {
  const reply: HistoryMessage = { ts: '2', thread_ts: '1' };
  const other: HistoryMessage = { ts: '3', thread_ts: '9' };
  const top: HistoryMessage = { ts: '4' };

  assert.equal(inHistory(reply, '1'), true);
  assert.equal(inHistory(other, '1'), false);
  assert.equal(inHistory(top, '1'), false);
});

test('withTimestamps: splices into the covering slice in string order', () => {
  const history = {
    slices: [{ timestamps: ['1.000002', '1.000004'], start: '1.000002', end: '1.000004' }],
  };
  const next = withTimestamps(history, ['1.000003', '1.000004']);
  assert.notEqual(next, history.slices);
  assert.deepEqual(next[0].timestamps, ['1.000002', '1.000003', '1.000004']);
});

test('withTimestamps: first slice covers older timestamps when reachedStart is set', () => {
  const history = {
    reachedStart: true,
    slices: [{ timestamps: ['1.000002'], start: '1.000002', end: '1.000002' }],
  };
  const next = withTimestamps(history, ['1.000001']);
  assert.deepEqual(next[0].timestamps, ['1.000001', '1.000002']);
});

test('withTimestamps: last slice covers newer timestamps when reachedEnd is set', () => {
  const history = {
    reachedEnd: true,
    slices: [
      { timestamps: ['1.000001'], start: '1.000001', end: '1.000001' },
      { timestamps: ['1.000002'], start: '1.000002', end: '1.000002' },
    ],
  };
  const next = withTimestamps(history, ['1.000003']);
  assert.equal(next[0].timestamps?.includes('1.000003'), false);
  assert.deepEqual(next[1].timestamps, ['1.000002', '1.000003']);
});

test('withTimestamps: returns the original slices when nothing is missing', () => {
  const slices = [{ timestamps: ['1.000001'], start: '1.000001', end: '1.000001' }];
  const next = withTimestamps({ slices }, ['1.000001']);
  assert.equal(next, slices);
});

test('withTimestamps: removes hidden reply timestamps already present in channel history', () => {
  const messages: HistoryMessage[] = [
    { ts: '1', thread_ts: '1' },
    { ts: '2', thread_ts: '1' },
    { ts: '3', thread_ts: '1', subtype: 'thread_broadcast' },
    { ts: '4', thread_ts: '9' },
  ];
  const history = { slices: [{ timestamps: ['1', '2', '3', '4', '5'] }] };
  const select = (thread: string | undefined) =>
    withTimestamps(
      history,
      messages.filter((msg) => inHistory(msg, thread)).map((msg) => msg.ts!),
      messages.filter((msg) => !inHistory(msg, thread)).map((msg) => msg.ts!),
    );
  assert.deepEqual(select(undefined)[0].timestamps, ['1', '3', '5']);
  assert.deepEqual(select('1')[0].timestamps, ['1', '2', '3', '5']);
  assert.deepEqual(history.slices[0].timestamps, ['1', '2', '3', '4', '5']);
  assert.deepEqual(withTimestamps(history, [], ['2', '4'])[0].timestamps, ['1', '3', '5']);
  assert.equal(withTimestamps(history, [], ['absent']), history.slices);
});

test('withTimestamps: indexed membership preserves duplicate additions and permits excluded timestamps to be restored', () => {
  const first = {
    timestamps: ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'],
    start: '00',
    end: '30',
  };
  const second = { timestamps: ['99'], start: '90', end: '99' };
  const history = { slices: [first, second] };
  const next = withTimestamps(
    history,
    ['01', '01', '03', '05', '07', '09', '11', '13', '15', '16'],
    ['00', '02', '04', '06', '08', '10', '12', '14', '16'],
  );
  assert.deepEqual(next[0].timestamps, ['01', '01', '03', '05', '07', '09', '11', '13', '15', '16', '18', '20', '22']);
  assert.equal(next[1], second);
  assert.deepEqual(first.timestamps, ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22']);
});

test('withTimestamps: larger membership indexes preserve unchanged history and ignore out-of-range additions', () => {
  const timestamps = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09'];
  const slices = [{ timestamps, start: '00', end: '09' }];
  const absent = ['10', '11', '12', '13', '14', '15', '16', '17', '18'];
  assert.equal(withTimestamps({ slices }, timestamps, absent), slices);
  assert.equal(withTimestamps({ slices }, absent), slices);
  assert.equal(slices[0].timestamps, timestamps);
});

test('withTimestamps: sparse history arrays still discard holes and retain duplicate injected timestamps', () => {
  const timestamps: string[] = [];
  timestamps.length = 12;
  timestamps[0] = '02';
  timestamps[11] = '06';
  const history = { slices: [{ timestamps }] };
  const next = withTimestamps(history, ['03', '03', '04', '05', '07', '08', '09', '10', '11']);
  assert.deepEqual(next[0].timestamps, ['02', '03', '03', '04', '05', '06', '07', '08', '09', '10', '11']);
  assert.equal(timestamps.length, 12);
  assert.equal(1 in timestamps, false);
});

test('withLiveThread: a restored parent takes reply state from the live tombstone', () => {
  const logged = { ts: '1', thread_ts: '1', text: 'hi', reply_count: 1, reply_users: ['U1'] };
  const tombstone = { ts: '1', thread_ts: '1', subtype: 'tombstone', reply_count: 9, reply_users: ['U1', 'U2'] };
  const next = withLiveThread(logged, tombstone);
  assert.equal(next.text, 'hi');
  assert.equal(next.reply_count, 9);
  assert.deepEqual(next.reply_users, ['U1', 'U2']);
  assert.equal('subtype' in next, false);
});

test('withLiveThread: keeps identity when nothing differs or nothing is live', () => {
  const logged = { ts: '1', thread_ts: '1', reply_count: 2 };
  assert.equal(withLiveThread(logged, undefined), logged);
  assert.equal(withLiveThread(logged, { ts: '1', thread_ts: '1', reply_count: 2 }), logged);
  assert.equal(withLiveThread(logged, { ts: '1', subtype: 'tombstone' }), logged);
});
