import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapConcurrent } from './concurrent.ts';

test('bounds in-flight work and preserves order through out-of-order completion', async () => {
  const gates = Array.from({ length: 5 }, () => Promise.withResolvers<number>());
  const started: number[] = [];
  let active = 0;
  let peak = 0;
  const result = mapConcurrent([0, 1, 2, 3, 4], 2, async (value) => {
    started.push(value);
    peak = Math.max(peak, ++active);
    const output = await gates[value].promise;
    active--;
    return output;
  });
  assert.deepEqual(started, [0, 1]);
  gates[1].resolve(11);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2]);
  gates[2].resolve(12);
  gates[0].resolve(10);
  await new Promise<void>((resolve) => setImmediate(resolve));
  gates[4].resolve(14);
  gates[3].resolve(13);
  assert.deepEqual(await result, [10, 11, 12, 13, 14]);
  assert.equal(peak, 2);
});

test('handles empty input, fewer values than workers, and invalid limits', async () => {
  assert.deepEqual(
    await mapConcurrent([], 16, async () => {
      throw new Error('unused');
    }),
    [],
  );
  assert.deepEqual(await mapConcurrent([1], 16, async (value) => value * 2), [2]);
  for (const limit of [0, -1, 1.5, Infinity, NaN]) {
    await assert.rejects(
      mapConcurrent([1], limit, async (value) => value),
      RangeError,
    );
  }
});
