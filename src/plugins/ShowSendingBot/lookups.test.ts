import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { build } from 'esbuild';
import { Cache, ScopedStorage } from '../../app/api/storage.ts';

const bundle = await build({
  entryPoints: [new URL('./index.tsx', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { default: ShowSendingBot } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

async function drain() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function fixture(t: TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  Object.defineProperty(globalThis, 'React', { configurable: true, value: { createContext: () => ({}) } });
  const originalTimeout = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  globalThis.setTimeout = ((fn: () => void) => {
    timers.set(++nextTimer, fn);
    return nextTimer;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout;
  const disk = new Map<string, string>();
  const storage = new ScopedStorage({
    list: async () => [...disk.keys()],
    read: async (key) => disk.get(key) ?? null,
    readAll: async () => Object.fromEntries(disk),
    write: async (key, value) => (disk.set(key, value), true),
    delete: async (key) => disk.delete(key),
    clear: async () => (disk.clear(), true),
  });
  const controller = new AbortController();
  const requests: {
    groups: { channel: string; timestamps: string[] }[];
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }[] = [];
  let refreshes = 0;
  const plugin = new ShowSendingBot(
    {
      signal: controller.signal,
      Cache: (name: string, ttl: number, max: number) => new Cache(storage, name, ttl, max),
      userAPI(_method: string, params: { message_ids: string }) {
        return new Promise((resolve, reject) =>
          requests.push({ groups: JSON.parse(params.message_ids), resolve, reject }),
        );
      },
      redux: { refresh: () => refreshes++ },
    },
    {},
  );
  t.after(() => {
    controller.abort();
    plugin.stop();
    globalThis.setTimeout = originalTimeout;
    globalThis.clearTimeout = originalClear;
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  });
  return {
    plugin,
    controller,
    requests,
    timers,
    get refreshes() {
      return refreshes;
    },
    tick() {
      const scheduled = [...timers.values()];
      timers.clear();
      for (const fn of scheduled) fn();
    },
  };
}

test('an unresolved app batch is not requeued by renders; unrelated messages can load', async (t) => {
  const f = fixture(t);
  const first = { channel: 'CA', ts: '1' };
  f.plugin.appIdOf(first);
  f.tick();
  for (let i = 0; i < 100; i++) {
    f.plugin.appIdOf(first);
    f.tick();
  }
  assert.equal(f.requests.length, 1);
  assert.equal(f.timers.size, 0);
  f.plugin.appIdOf({ channel: 'CB', ts: '2' });
  f.tick();
  assert.equal(f.requests.length, 2, 'a slow batch does not block other messages');
  f.requests[0]!.resolve({ messages: { CA: [{ ts: '1', app_id: 'A1' }] } });
  f.requests[1]!.resolve({ messages: {} });
  await drain();
  assert.equal(f.plugin.appIdOf(first), 'A1');
  assert.equal(f.plugin.appIdOf({ channel: 'CB', ts: '2' }), undefined);
  assert.equal(f.timers.size, 0, 'missing app IDs are cached as null');
  assert.equal(f.plugin.inFlightApps.size, 0);
  assert.equal(f.refreshes, 2);
  f.plugin.apps.forget('CA:1');
  f.plugin.appIdOf(first);
  f.tick();
  assert.equal(f.requests.length, 3, 'an expired or forgotten value may be fetched again');
  f.requests[2]!.resolve({ messages: { CA: [{ ts: '1', app_id: 'A2' }] } });
  await drain();
  assert.equal(f.plugin.appIdOf(first), 'A2');
});

test('batch limits and queued messages survive while active keys stay deduplicated', async (t) => {
  const f = fixture(t);
  const messages = Array.from({ length: 180 }, (_, i) => ({ channel: `C${Math.floor(i / 30)}`, ts: `${i}` }));
  for (const msg of messages) f.plugin.appIdOf(msg);
  f.tick();
  for (const msg of messages) f.plugin.appIdOf(msg);
  f.tick();
  assert.equal(f.requests.length, 2);
  const seen = new Set<string>();
  for (const request of f.requests) {
    assert.ok(request.groups.length <= 5);
    assert.ok(request.groups.reduce((n, group) => n + group.timestamps.length, 0) <= 100);
    for (const group of request.groups)
      for (const ts of group.timestamps) {
        const key = `${group.channel}:${ts}`;
        assert.ok(!seen.has(key));
        seen.add(key);
      }
    request.resolve({ messages: {} });
  }
  await drain();
  assert.equal(seen.size, messages.length);
  assert.equal(f.plugin.pendingApps.size, 0);
  assert.equal(f.plugin.inFlightApps.size, 0);
});

test('failed batches do not retry on render, and a stopped instance cannot queue or repaint', async (t) => {
  const f = fixture(t);
  const msg = { channel: 'CA', ts: '1' };
  f.plugin.appIdOf(msg);
  f.tick();
  f.requests[0]!.reject(new Error('fixture failure'));
  await drain();
  f.plugin.appIdOf(msg);
  f.tick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.plugin.inFlightApps.size, 0);
  f.plugin.appIdOf({ channel: 'CA', ts: '2' });
  f.tick();
  f.plugin.appIdOf({ channel: 'CA', ts: '3' });
  f.plugin.stop();
  assert.equal(f.timers.size, 0);
  assert.equal(f.plugin.pendingApps.size, 0);
  const refreshes = f.refreshes;
  f.requests[1]!.resolve({ messages: {} });
  await drain();
  f.plugin.appIdOf({ channel: 'CA', ts: '4' });
  f.tick();
  assert.equal(f.requests.length, 2);
  assert.equal(f.refreshes, refreshes);
  assert.equal(f.plugin.inFlightApps.size, 0);
  const restarted = new ShowSendingBot({ ...f.plugin.api, signal: new AbortController().signal }, {});
  restarted.appIdOf(msg);
  f.tick();
  assert.equal(f.requests.length, 3, "a new instance can retry a previous instance's failed lookup");
  f.requests[2]!.resolve({ messages: { CA: [{ ts: '1', app_id: 'A1' }] } });
  await drain();
  assert.equal(restarted.appIdOf(msg), 'A1');
  restarted.stop();
});
