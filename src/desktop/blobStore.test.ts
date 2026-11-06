import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as blobs from './blobStore.ts';

test('bulk reads preserve all values and prefix selection across multiple worker batches', async () => {
  const previous = process.env.SLICK_HANDOFF_PROFILE;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'slick-blob-read-'));
  process.env.SLICK_HANDOFF_PROFILE = dir;
  try {
    const expected = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`message:${index}`, `${index}`]));
    for (const [key, value] of Object.entries(expected)) assert.equal(await blobs.write('test', key, value), true);
    assert.equal(await blobs.write('test', 'metadata', '{}'), true);
    assert.deepEqual(await blobs.readAll('test', 'message:'), expected);
    assert.deepEqual(await blobs.readAll('test'), { ...expected, metadata: '{}' });
    assert.deepEqual(await blobs.readAll('missing'), {});
    assert.deepEqual(await blobs.readAll('test', 'absent:'), {});
  } finally {
    if (previous === undefined) delete process.env.SLICK_HANDOFF_PROFILE;
    else process.env.SLICK_HANDOFF_PROFILE = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
