import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inHistory, withTimestamps, type HistoryMessage } from './messageHistory.ts';

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
