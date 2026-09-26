import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BlobStore } from './storage.ts';
import { MAX_STORED_FILE, fileLabel, isStoredFile, readStoredFile, writeStoredFile } from './storedFiles.ts';

function fakeBlob() {
  const files = new Map<string, string>();
  const store: BlobStore = {
    list: async () => [...files.keys()],
    read: async (key) => files.get(key) ?? null,
    readAll: async () => ({}),
    write: async (key, value) => (files.set(key, value), true),
    delete: async (key) => files.delete(key),
    clear: async () => (files.clear(), true),
  };
  return { files, store };
}

const named = (bytes: Uint8Array<ArrayBuffer>, name: string, type = 'font/woff2') =>
  Object.assign(new Blob([bytes], { type }), { name });

test('a stored file round-trips through chunks and labels as its name', async () => {
  const { files, store } = fakeBlob();
  const bytes = new Uint8Array(400 * 1024).map((_, index) => (index * 7) % 256);
  const value = await writeStoredFile(store, 'fontPath', named(bytes, 'My Font.woff2'));

  assert.ok(isStoredFile(value));
  assert.equal(fileLabel(value), 'My Font.woff2');
  assert.equal(fileLabel('~/fonts/a.ttf'), '~/fonts/a.ttf');
  assert.deepEqual([...files.keys()].toSorted(), [
    'file:fontPath',
    'file:fontPath:0',
    'file:fontPath:1',
    'file:fontPath:2',
  ]);
  for (const [key, part] of files) if (key !== 'file:fontPath') assert.ok(part.length < 256 * 1024 - 128);

  const read = await readStoredFile(store, 'fontPath');
  assert.equal(read?.type, 'font/woff2');
  assert.deepEqual(new Uint8Array(await read!.arrayBuffer()), bytes);
});

test('a smaller replacement drops the old chunks; missing chunks read as nothing', async () => {
  const { files, store } = fakeBlob();
  await writeStoredFile(store, 'soundPath', named(new Uint8Array(400 * 1024), 'long.mp3', 'audio/mpeg'));
  const small = new Uint8Array([1, 2, 3]);
  await writeStoredFile(store, 'soundPath', named(small, 'short.mp3', 'audio/mpeg'));
  assert.deepEqual([...files.keys()].toSorted(), ['file:soundPath', 'file:soundPath:0']);
  assert.deepEqual(new Uint8Array(await (await readStoredFile(store, 'soundPath'))!.arrayBuffer()), small);

  files.delete('file:soundPath:0');
  assert.equal(await readStoredFile(store, 'soundPath'), null);
  assert.equal(await readStoredFile(store, 'other'), null);
  await assert.rejects(
    writeStoredFile(store, 'soundPath', named(new Uint8Array(MAX_STORED_FILE + 1), 'huge.wav')),
    /over 16 MB/,
  );
});
