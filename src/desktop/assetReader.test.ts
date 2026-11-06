import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAssetReader } from './assetReader.ts';

test('concurrent loads share IO and packaged assets remain cached', async () => {
  let calls = 0;
  let finish!: (bytes: Uint8Array<ArrayBuffer>) => void;
  const read = createAssetReader(true, () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = read('bundle');
  assert.equal(read('bundle'), first);
  finish(new Uint8Array([1, 2]));
  assert.deepEqual(await first, new Uint8Array([1, 2]));
  assert.equal(read('bundle'), first);
  assert.equal(calls, 1);
});

test('development loads see new bytes and failed packaged reads can retry', async () => {
  let version = 0;
  const read = createAssetReader(false, async () => new Uint8Array([++version]));
  assert.deepEqual(await read('bundle'), new Uint8Array([1]));
  assert.deepEqual(await read('bundle'), new Uint8Array([2]));
  let attempts = 0;
  const retry = createAssetReader(true, async () => {
    if (++attempts === 1) throw new Error('missing');
    return new Uint8Array([3]);
  });
  await assert.rejects(retry('bundle'), /missing/);
  assert.deepEqual(await retry('bundle'), new Uint8Array([3]));
});
