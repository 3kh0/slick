import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as store from './blobStore.ts';

test('disk batches preserve ordering, validate before writing and leave no temp files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'slick-storage-test-'));
  const previous = process.env.SLICK_HANDOFF_PROFILE;
  process.env.SLICK_HANDOFF_PROFILE = dir;
  try {
    const ns = 'plugin:MessageLogger';
    assert.equal(
      await store.mutate(ns, [
        ['a', 'first'],
        ['b', 'other'],
        ['a', 'last'],
      ]),
      true,
    );
    assert.deepEqual(await store.readAll(ns), { a: 'last', b: 'other' });
    assert.deepEqual(
      await Promise.all([
        store.mutate(ns, [
          ['a', 'new'],
          ['b', null],
        ]),
        store.clear(ns),
        store.write(ns, 'a', 'after clear'),
      ]),
      [true, true, true],
    );
    assert.deepEqual(await store.readAll(ns), { a: 'after clear' });
    assert.equal(
      await store.mutate(ns, [
        ['a', 'bad'],
        ['b', 'x'.repeat(8 * 1024 * 1024 + 1)],
      ]),
      false,
    );
    assert.equal(await store.read(ns, 'a'), 'after clear');
    assert.equal(await store.mutate(ns, [['..', 'bad']]), false);
    const files = await readdir(
      path.join(dir, 'slick/storage/plugin:MessageLogger'.replaceAll(':', process.platform === 'win32' ? '%3A' : ':')),
    );
    assert.deepEqual(files, ['a.json']);
  } finally {
    if (previous === undefined) delete process.env.SLICK_HANDOFF_PROFILE;
    else process.env.SLICK_HANDOFF_PROFILE = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
