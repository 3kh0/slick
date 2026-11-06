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

function postedTasks(t: import('node:test').TestContext) {
  const pending: (() => void)[] = [];
  let closed = 0;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'MessageChannel');
  class Channel {
    callback: (() => void) | undefined;
    started = false;
    port1 = {
      addEventListener: (_event: string, callback: () => void) => {
        this.callback = callback;
      },
      start: () => {
        this.started = true;
      },
      close: () => closed++,
    };
    port2 = {
      postMessage: () =>
        pending.push(() => {
          assert.equal(this.started, true);
          this.callback?.();
        }),
      close: () => closed++,
    };
  }
  Object.defineProperty(globalThis, 'MessageChannel', { configurable: true, value: Channel });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'MessageChannel', descriptor);
    else Reflect.deleteProperty(globalThis, 'MessageChannel');
  });
  return { pending, closed: () => closed };
}

test('entries: reads a whole prefix, skipping unparseable values', async () => {
  const { files, store } = fakeBlob();
  files.set('entry:a', '{"n":1}');
  files.set('entry:b', 'not json');
  files.set('other', '{"n":2}');

  const out = await new ScopedStorage(store).entries<{ n: number }>('entry:');
  assert.deepEqual([...out], [['entry:a', { n: 1 }]]);
});

test('entries: large parse batches yield to queued work without changing order or error handling', async (t) => {
  const { files, store } = fakeBlob();
  for (let i = 0; i < 140; i++) files.set(`entry:${i}`, JSON.stringify(i));
  files.set('entry:70', 'broken');
  let now = 0;
  t.mock.method(performance, 'now', () => (now += 10));
  const { pending, closed } = postedTasks(t);
  t.mock.method(globalThis, 'setTimeout', () => assert.fail('fallback must not use throttled timers'));
  let done = false;
  const operation = new ScopedStorage(store).entries<number>('entry:').then((out) => {
    done = true;
    return out;
  });
  // Wait for readAll and its error-handler continuation.
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(done, false);
  assert.equal(pending.length, 1, 'first batch leaves a task boundary');
  pending.shift()!();
  for (let i = 0; i < 10 && !pending.length; i++) await Promise.resolve();
  assert.equal(done, false);
  assert.equal(pending.length, 1, 'second batch also yields');
  pending.shift()!();
  const out = await operation;
  assert.deepEqual(
    [...out.keys()],
    [...files.keys()].filter((key) => key !== 'entry:70'),
  );
  assert.equal(out.get('entry:139'), 139);
  assert.equal(pending.length, 0, 'no unnecessary yield after the final batch');
  assert.equal(closed(), 4, 'both ports are closed after each yield');
});

test('entries: small loads and read failures do not schedule additional tasks', async (t) => {
  const { files, store } = fakeBlob();
  files.set('one', '1');
  t.mock.method(globalThis, 'setTimeout', () => assert.fail('small load yielded'));
  assert.deepEqual([...(await new ScopedStorage(store).entries())], [['one', 1]]);
  store.readAll = async () => {
    throw new Error('unavailable');
  };
  assert.equal((await new ScopedStorage(store).entries()).size, 0);
});

test('entries: large individual records yield through the browser scheduler', async (t) => {
  const { files, store } = fakeBlob();
  const data = 'x'.repeat(33_000);
  for (let i = 0; i < 3; i++) files.set(`image:${i}`, JSON.stringify(data));
  let now = 0;
  t.mock.method(performance, 'now', () => (now += 5));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');
  let yielded = 0;
  const scheduler = {
    async yield() {
      assert.equal(this, scheduler, 'native scheduler keeps its receiver');
      yielded++;
    },
  };
  Object.defineProperty(globalThis, 'scheduler', { configurable: true, value: scheduler });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'scheduler', descriptor);
    else Reflect.deleteProperty(globalThis, 'scheduler');
  });
  t.mock.method(globalThis, 'setTimeout', () => assert.fail('native yield should not use timers'));
  const entries = await new ScopedStorage(store).entries('image:');
  assert.equal(entries.size, 3);
  assert.equal(entries.get('image:2'), data);
  assert.equal(yielded, 2, 'large records check the budget without waiting for 64 parses');
});

test('entries: an aborted scheduler task falls back and finishes the read', async (t) => {
  const { files, store } = fakeBlob();
  const data = JSON.stringify('x'.repeat(33_000));
  files.set('one', data);
  files.set('two', data);
  let now = 0;
  t.mock.method(performance, 'now', () => (now += 5));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');
  Object.defineProperty(globalThis, 'scheduler', {
    configurable: true,
    value: {
      yield: async () => {
        throw new Error('task aborted');
      },
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'scheduler', descriptor);
    else Reflect.deleteProperty(globalThis, 'scheduler');
  });
  const { pending, closed } = postedTasks(t);
  t.mock.method(globalThis, 'setTimeout', () => assert.fail('aborted tasks must also avoid throttled timers'));
  const reading = new ScopedStorage(store).entries();
  for (let i = 0; i < 10 && !pending.length; i++) await Promise.resolve();
  assert.equal(pending.length, 1);
  pending.shift()!();
  assert.equal((await reading).size, 2);
  assert.equal(closed(), 2);
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

test('Cache: a TTL function sets expiry per value', async () => {
  const { files, store } = fakeBlob();
  const cache = new Cache<string>(new ScopedStorage(store), 't', (value) => (value === 'no' ? -1 : 60_000));
  let calls = 0;

  await cache.get('k', async () => (calls++, 'no'));
  await settle();
  assert.ok(JSON.parse(files.get('cache:t:k')!).expires <= Date.now());
  assert.equal(await cache.get('k', async () => (calls++, 'yes')), 'yes');
  assert.equal(await cache.get('k', async () => (calls++, 'no')), 'yes');
  assert.equal(calls, 2);
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

test('Cache: maintenance parsing adds no task gaps and a new instance keeps its fresh writes', async (t) => {
  const { files, store } = fakeBlob();
  for (let i = 0; i < 128; i++) files.set(`cache:t:${i}`, JSON.stringify({ value: 'old', expires: Date.now() - 1 }));
  let now = 0;
  let scheduled = 0;
  t.mock.method(performance, 'now', () => (now += 10));
  t.mock.method(globalThis, 'setTimeout', (callback: () => void) => {
    scheduled++;
    queueMicrotask(callback);
    return 0;
  });

  const first = new Cache(new ScopedStorage(store), 't');
  assert.equal(await first.get('trigger', async () => 'initial'), 'initial');
  const restarted = new Cache(new ScopedStorage(store), 't');
  assert.equal(await restarted.get('0', async () => 'fresh'), 'fresh');
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(scheduled, 0, 'cache maintenance parsing adds no tasks');
  assert.equal(JSON.parse(files.get('cache:t:0')!).value, 'fresh');
  assert.equal(files.has('cache:t:1'), false, 'untouched expired entries still get removed');
});
