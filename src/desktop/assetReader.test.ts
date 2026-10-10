import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAssetReader } from './assetReader.ts';

test('packaged assets share reads; development reloads see new bytes', async () => {
  for (const cache of [false, true]) {
    let reads = 0;
    const read = createAssetReader(cache, async () => Buffer.from(String(++reads)));
    const [a, b] = await Promise.all([read('bundle'), read('bundle')]);
    assert.equal(a, b);
    assert.equal(reads, 1);
    assert.equal((await read('bundle')).toString(), cache ? '1' : '2');
  }
});

test('a missing asset can become available after a failed request', async () => {
  let missing = true;
  const read = createAssetReader(true, async () => {
    if (missing) throw new Error('not built');
    return Buffer.from('built');
  });
  await assert.rejects(read('bundle'), /not built/);
  missing = false;
  assert.equal((await read('bundle')).toString(), 'built');
});
