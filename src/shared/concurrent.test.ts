import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapConcurrent } from './concurrent.ts';

test('bounded work keeps input order and drains active workers before rejecting', async () => {
  let active = 0;
  let peak = 0;
  const output = await mapConcurrent(
    [4, 3, 2, 1],
    async (value) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active--;
      return value * 2;
    },
    2,
  );
  assert.deepEqual(output, [8, 6, 4, 2]);
  assert.equal(peak, 2);
  let drained = false;
  await assert.rejects(
    mapConcurrent(
      [0, 1],
      async (value) => {
        if (!value) throw new Error('failure');
        await new Promise((resolve) => setTimeout(resolve, 10));
        drained = true;
        return value;
      },
      2,
    ),
    /failure/,
  );
  assert.equal(drained, true);
});
