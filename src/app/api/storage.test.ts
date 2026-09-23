import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Cache, type BlobStore, ScopedStorage } from './storage.ts';

/** An in-memory stand-in for the main process's blob store. */
function fakeBlob() {
  const files = new Map<string, string>();
  const store: BlobStore = {
    list: async () => [...files.keys()],
    read: async (key) => files.get(key) ?? null,
    readAll: async (prefix = '') => Object.fromEntries([...files].filter(([key]) => key.startsWith(prefix))),
    write: async (key, value) => (files.set(key, value), true),
    delete: async (key) => files.delete(key),
    clear: async () => (files.clear(), true),
  };
  return { files, store };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('entries: reads a whole prefix, skipping unparseable values', async () => {
  const { files, store } = fakeBlob();
  files.set('entry:a', '{"n":1}');
  files.set('entry:b', 'not json');
  files.set('other', '{"n":2}');

  const out = await new ScopedStorage(store).entries<{ n: number }>('entry:');
  assert.deepEqual([...out], [['entry:a', { n: 1 }]]);
});

test('Cache: sweeps expired blobs off disk, once, and keeps live ones', async () => {
  const { files, store } = fakeBlob();
  const storage = new ScopedStorage(store);
  files.set('cache:t:stale', JSON.stringify({ value: 1, expires: Date.now() - 1 }));
  files.set('cache:t:live', JSON.stringify({ value: 2, expires: Date.now() + 60_000 }));
  // Another cache's blobs, and a plain key, are not this cache's to delete.
  files.set('cache:other:live', JSON.stringify({ value: 3, expires: Date.now() - 1 }));
  files.set('observed', '{}');

  const cache = new Cache<number>(storage, 't');
  await cache.get('fresh', async () => 9);
  await settle();

  assert.deepEqual([...files.keys()].toSorted(), ['cache:other:live', 'cache:t:fresh', 'cache:t:live', 'observed']);
});

test('Cache: a hit does not refetch, and a miss de-duplicates in flight', async () => {
  const { store } = fakeBlob();
  const cache = new Cache<number>(new ScopedStorage(store), 't');
  let calls = 0;
  const fetcher = async () => (calls++, 7);

  const [a, b] = await Promise.all([cache.get('k', fetcher), cache.get('k', fetcher)]);
  assert.deepEqual([a, b], [7, 7]);
  assert.equal(await cache.get('k', fetcher), 7);
  assert.equal(calls, 1);
});

test('Cache: memory is bounded even when nothing has expired', async () => {
  const { store } = fakeBlob();
  // A long TTL is the point: without a ceiling, a per-message key grows for
  // as long as the session lasts.
  const cache = new Cache<number>(new ScopedStorage(store), 't', 60 * 60 * 1000, 10);
  for (let i = 0; i < 200; i++) await cache.get(`k${i}`, async () => i);

  assert.ok((cache as any).memory.size <= 10, `memory held ${(cache as any).memory.size}`);
  // The most recent survives; the oldest is gone.
  assert.equal(cache.peek('k199'), 199);
  assert.equal(cache.peek('k0'), undefined);
});

test('Cache: expired entries leave memory rather than lingering as misses', async () => {
  const { store } = fakeBlob();
  const cache = new Cache<number>(new ScopedStorage(store), 't', -1);
  for (let i = 0; i < 600; i++) await cache.get(`k${i}`, async () => i);
  assert.ok((cache as any).memory.size < 600, `memory held ${(cache as any).memory.size}`);
});
