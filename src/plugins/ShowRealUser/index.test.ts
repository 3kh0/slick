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
const { default: ShowRealUser } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);
const bot = 'B08G06U6SJG';
async function drain() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function fixture(t: TestContext) {
  const originalTimeout = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout;
  const timers = new Map<number, () => void>();
  let nextTimer = 0,
    scheduled = 0,
    refreshes = 0,
    cacheGets = 0,
    logs = 0;
  globalThis.setTimeout = ((fn: () => void) => {
    timers.set(++nextTimer, fn);
    scheduled++;
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
  const requests: { ts: string; resolve: (value: any) => void; reject: (error: Error) => void }[] = [];
  let profile = { display_name: 'First', real_name: 'Full', image_48: 'first.png' };
  const api = {
    signal: controller.signal,
    Cache(name: string, ttl: number) {
      const cache = new Cache(storage, name, ttl),
        get = cache.get.bind(cache);
      cache.get = (...args) => {
        cacheGets++;
        return get(...args);
      };
      return cache;
    },
    userAPI(_method: string, params: { ts: string }) {
      return new Promise((resolve, reject) => requests.push({ ts: params.ts, resolve, reject }));
    },
    redux: { refresh: () => refreshes++ },
    members: { getCachedMember: () => ({ profile }) },
  };
  const plugin = new ShowRealUser(api, {});
  plugin.log = () => logs++;
  t.after(() => {
    plugin.stop();
    controller.abort();
    globalThis.setTimeout = originalTimeout;
    globalThis.clearTimeout = originalClear;
  });
  return {
    plugin,
    api,
    requests,
    timers,
    get counts() {
      return { cacheGets, scheduled, refreshes, logs };
    },
    setProfile(next: typeof profile) {
      profile = next;
    },
    tick() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const fn of callbacks) fn();
    },
    complete(index: number, sender?: string) {
      const request = requests[index]!;
      request.resolve({
        messages: [{ ts: request.ts, bot_id: bot, metadata: { event_payload: { source_user_id: sender } } }],
      });
    },
  };
}

test('repeat sender reads share one continuation and keep cache and member freshness', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 100; i++) assert.equal(f.plugin.senderOf('C', '1'), undefined);
  await drain();
  assert.equal(f.requests.length, 1);
  assert.equal(f.counts.cacheGets, 1);
  f.plugin.senderOf('C', '2');
  await drain();
  assert.equal(f.requests.length, 2);
  f.complete(0, 'U1');
  f.complete(1, 'U2');
  await drain();
  assert.equal(f.plugin.senderOf('C', '1'), 'U1');
  assert.equal(f.plugin.senderOf('C', '2'), 'U2');
  assert.equal(f.counts.scheduled, 2);
  assert.equal(f.timers.size, 1, 'distinct completed lookups still debounce into one repaint');
  assert.equal(f.plugin.pending.size, 0);
  f.tick();
  assert.equal(f.counts.refreshes, 1);
  const attachment = {
    channel_id: 'C',
    ts: '1',
    author_link: `https://fixture.invalid/services/${bot}`,
    author_name: 'Relay',
  };
  assert.equal(f.plugin.asForwardedBy(attachment).author_name, 'First');
  f.setProfile({ display_name: 'Updated', real_name: 'Full', image_48: 'updated.png' });
  const updated = f.plugin.asForwardedBy(attachment);
  assert.equal(updated.author_name, 'Updated');
  assert.equal(updated.author_icon, 'updated.png');
  assert.equal(attachment.author_name, 'Relay', 'the original forward stays unchanged');
  f.plugin.senders.forget('C:1');
  f.plugin.senderOf('C', '1');
  await drain();
  assert.equal(f.requests.length, 3);
  f.complete(2, 'U3');
  await drain();
  assert.equal(f.plugin.senderOf('C', '1'), 'U3');
});

test('null senders stay cached and failed lookups log once until a fresh instance retries', async (t) => {
  const f = fixture(t);
  f.plugin.senderOf('C', '1');
  for (let i = 0; i < 100; i++) f.plugin.senderOf('C', '2');
  await drain();
  f.complete(0);
  f.requests[1]!.reject(new Error('fixture failure'));
  await drain();
  f.plugin.senderOf('C', '1');
  f.plugin.senderOf('C', '2');
  await drain();
  assert.equal(f.requests.length, 2);
  assert.equal(f.counts.logs, 1);
  assert.equal(f.plugin.pending.size, 0);
  const restarted = new ShowRealUser({ ...f.api, signal: new AbortController().signal }, {});
  restarted.senderOf('C', '2');
  await drain();
  assert.equal(f.requests.length, 3);
  f.complete(2, 'U2');
  await drain();
  assert.equal(restarted.senderOf('C', '2'), 'U2');
  restarted.stop();
});

test('stopping while a lookup is pending releases bookkeeping and prevents late repaint work', async (t) => {
  const f = fixture(t);
  f.plugin.senderOf('C', '1');
  await drain();
  // PluginManager calls stop before disposing the scope's AbortSignal.
  f.plugin.stop();
  assert.equal(f.plugin.pending.size, 0);
  f.complete(0, 'U1');
  await drain();
  f.plugin.senderOf('C', '2');
  await drain();
  assert.equal(f.requests.length, 1);
  assert.equal(f.counts.scheduled, 0);
  assert.equal(f.counts.refreshes, 0);
});
