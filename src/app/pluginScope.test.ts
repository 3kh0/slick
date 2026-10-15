import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScope } from './pluginScope.ts';

test('manual disposal is once-only and remaining resources stop in reverse registration order', () => {
  const scope = createScope();
  const calls: string[] = [];
  scope.track(() => calls.push('first'));
  const middle = scope.track(() => calls.push('middle'));
  scope.track(() => calls.push('last'));
  middle();
  middle();
  scope.dispose();
  scope.dispose();
  assert.equal(scope.signal.aborted, true);
  assert.deepEqual(calls, ['middle', 'last', 'first']);
});

test('cleanup can recurse and stop another registration without double execution', () => {
  const scope = createScope();
  const calls: string[] = [];
  const earlier = scope.track(() => calls.push('earlier'));
  const later = scope.track(() => {
    calls.push('later');
    later();
    earlier();
    scope.dispose();
  });
  scope.dispose();
  assert.deepEqual(calls, ['later', 'earlier']);
});

test('abort listeners may release resources and late registrations clean up immediately', () => {
  const scope = createScope();
  const calls: string[] = [];
  const release = scope.track(() => calls.push('early'));
  scope.signal.addEventListener('abort', () => {
    release();
    scope.track(() => calls.push('during-abort'));
  });
  scope.dispose();
  const late = scope.track(() => calls.push('late'));
  late();
  assert.deepEqual(calls, ['early', 'during-abort', 'late']);
});

test('a throwing disposer stays disposed and does not interrupt remaining teardown', (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const scope = createScope();
  let calls = 0;
  const throws = scope.track(() => {
    calls++;
    throw new Error('cleanup failure');
  });
  assert.throws(throws, /cleanup failure/);
  throws();
  scope.track(() => calls++);
  scope.track(() => {
    throw new Error('teardown failure');
  });
  scope.dispose();
  assert.equal(calls, 2);
  assert.equal(errors.mock.callCount(), 1);
});
