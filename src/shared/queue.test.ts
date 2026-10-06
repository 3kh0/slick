import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serialQueue } from './queue.ts';

test('queued work waits for the active task and continues after a failure', async () => {
  const enqueue = serialQueue();
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const first = enqueue(async () => {
    events.push('start');
    await gate;
    events.push('fail');
    throw new Error('failed');
  });
  const rejected = assert.rejects(first, /failed/);
  const second = enqueue(() => {
    events.push('next');
    return 42;
  });
  await Promise.resolve();
  assert.deepEqual(events, ['start']);
  release();
  await rejected;
  assert.equal(await second, 42);
  assert.deepEqual(events, ['start', 'fail', 'next']);
});
