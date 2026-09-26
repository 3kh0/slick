import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOB_PREFIX, memoryBackend } from './blobs.ts';
import { createStorage, DEFAULT_SETTINGS, SETTINGS_KEY, CSS_KEY } from './storage.ts';
import { MAX_BLOB, MAX_KEYS, MAX_TEXT, PAGE_KEYS, RENDERERS, blobLimits } from './rpc.ts';
import { installBridge } from './bridge-setup.ts';
import type { StorageArea } from './rpc.ts';
export function memoryStorage(): StorageArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async () => structuredClone(data),
    set: async (items) => {
      Object.assign(data, structuredClone(items));
    },
    remove: async (keys) => {
      for (const key of [keys].flat()) delete data[key];
    },
  };
}
test('default-off config, JSON validation, CSS and storage constants', async () => {
  const area = memoryStorage();
  const store = createStorage(area, memoryBackend());
  assert.deepEqual(await store.dispatch({ method: 'readSettings', args: [] }), { ok: true, value: DEFAULT_SETTINGS });
  const config = JSON.parse(DEFAULT_SETTINGS);
  assert.equal(config.enabled, undefined);
  assert.deepEqual(Object.keys(config.plugins), [...RENDERERS]);
  assert.ok(Object.values(config.plugins).every((plugin) => JSON.stringify(plugin) === '{"enabled":false}'));
  for (const text of ['[]', 'null', '{', '42'])
    assert.equal((await store.dispatch({ method: 'writeSettings', args: [text] })).ok, false);
  assert.deepEqual(await store.dispatch({ method: 'writeSettings', args: ['{}'] }), { ok: true, value: true });
  await store.dispatch({ method: 'writeUserCss', args: ['body{}'] });
  assert.equal(area.data[SETTINGS_KEY], '{}');
  assert.equal(area.data[CSS_KEY], 'body{}');
  assert.equal((await store.dispatch({ method: 'writeUserCss', args: ['x'.repeat(MAX_TEXT + 1)] })).ok, false);
});
test('CAS serializes concurrent writers and recovers after failures', async () => {
  const store = createStorage(memoryStorage(), memoryBackend());
  const responses = await Promise.all(
    ['{"a":1}', '{"b":2}'].map((next) =>
      store.dispatch({ method: 'compareAndSwapSettings', args: [DEFAULT_SETTINGS, next] }),
    ),
  );
  assert.deepEqual(responses, [
    { ok: true, value: true },
    { ok: true, value: false },
  ]);
  await store.dispatch({ method: 'writeSettings', args: ['bad'] });
  assert.deepEqual(await store.dispatch({ method: 'readSettings', args: [] }), { ok: true, value: '{"a":1}' });
});
test('blobs are namespace allowlisted, bounded and prototype-safe', async () => {
  const area = memoryStorage();
  const store = createStorage(area, memoryBackend());
  for (const bad of ['Other', 'Censorship', 'plugin:Other'])
    assert.equal((await store.dispatch({ method: 'blob.write', args: [bad, 'x', 'y'] })).ok, false);
  assert.equal(
    (await store.dispatch({ method: 'blob.write', args: ['plugin:Censorship', 'x', 'y'.repeat(MAX_BLOB + 1)] })).ok,
    false,
  );
  for (const key of ['__proto__', 'constructor', 'toString'])
    await store.dispatch({ method: 'blob.write', args: ['plugin:Censorship', key, 'value'] });
  assert.deepEqual(await store.dispatch({ method: 'blob.read', args: ['plugin:Censorship', '__proto__'] }), {
    ok: true,
    value: 'value',
  });
  assert.deepEqual(await store.dispatch({ method: 'blob.list', args: ['plugin:HumanCount', ''] }), {
    ok: true,
    value: [],
  });
  assert.equal((await store.dispatch({ method: 'blob.write', args: ['plugin:Censorship', '', 'v'] })).ok, false);
  await store.dispatch({ method: 'blob.clear', args: ['plugin:Censorship'] });
  for (let i = 0; i < MAX_KEYS; i++)
    await store.dispatch({ method: 'blob.write', args: ['plugin:Censorship', String(i), 'v'] });
  assert.equal(
    (await store.dispatch({ method: 'blob.write', args: ['plugin:Censorship', 'overflow', 'v'] })).ok,
    false,
  );
});

const call = (store: ReturnType<typeof createStorage>, method: string, ...args: string[]) =>
  store.dispatch({ method, args }).then((response) => {
    if (!response.ok) throw new Error(response.error);
    return response.value;
  });

test('logging plugins get a larger quota; others keep the small one', async () => {
  const store = createStorage(memoryStorage(), memoryBackend());
  const big = 'x'.repeat(MAX_BLOB + 1);
  await assert.rejects(call(store, 'blob.write', 'plugin:Censorship', 'k', big));
  assert.equal(await call(store, 'blob.write', 'plugin:MessageLogger', 'k', big), true);
  const { keys, value } = blobLimits('plugin:MessageLogger');
  assert.ok(keys >= 1000 && value + 128 <= MAX_TEXT);
  for (let i = 0; i < MAX_KEYS + 10; i++) await call(store, 'blob.write', 'plugin:LastSeen', `cache:${i}`, 'v');
  // Overwrites and deletes free their share of the quota.
  for (let i = 0; i < 4; i++) await call(store, 'blob.write', 'plugin:Censorship', 'k', 'y'.repeat(MAX_BLOB));
  await call(store, 'blob.delete', 'plugin:Censorship', 'k');
  for (let i = 0; i < 8; i++) await call(store, 'blob.write', 'plugin:Censorship', `k${i}`, 'y'.repeat(MAX_BLOB));
  await assert.rejects(call(store, 'blob.write', 'plugin:Censorship', 'k8', 'y'));
});

test('list and readAll page through a namespace larger than one response', async () => {
  const backend = memoryBackend();
  const store = createStorage(memoryStorage(), backend);
  const ns = 'plugin:MessageLogger';
  for (let i = 0; i < PAGE_KEYS + 40; i++)
    await call(store, 'blob.write', ns, `entry:${String(i).padStart(4, '0')}`, 'e');
  for (let i = 0; i < 6; i++) await call(store, 'blob.write', ns, `entry:big${i}`, 'b'.repeat(100_000));
  await call(store, 'blob.write', ns, 'legacy', '{}');
  await call(store, 'blob.write', ns, '__proto__', 'p');

  const first = (await call(store, 'blob.readAll', ns, 'entry:', '')) as Record<string, string>;
  assert.equal(Object.keys(first).length, PAGE_KEYS);
  const size = Object.entries(first).reduce((sum, [k, v]) => sum + k.length + v.length, 0);
  assert.ok(size <= MAX_TEXT);

  // The page bridge, wired straight to the store, must reassemble every page.
  const listeners: ((event: any) => void)[] = [];
  const target: any = {
    location: { origin: 'https://app.slack.com', pathname: '/client/T' },
    sessionStorage: { getItem: () => null },
    addEventListener: (type: string, cb: (event: any) => void) => type === 'message' && listeners.push(cb),
    postMessage: (data: any) =>
      void store.dispatch({ method: data.method, args: data.args }).then((response) => {
        for (const cb of listeners)
          cb({ source: target, origin: target.location.origin, data: { ...data, kind: 'response', response } });
      }),
  };
  target.top = target;
  installBridge(target);
  const blob = target.SlickBridge.claim().blobStore(ns);
  const all = await blob.readAll('entry:');
  assert.equal(Object.keys(all).length, PAGE_KEYS + 46);
  assert.equal(all['entry:big5'].length, 100_000);
  assert.equal((await blob.readAll()).__proto__, 'p');
  assert.equal(Object.hasOwn(await blob.readAll(), '__proto__'), true);
  assert.equal((await blob.list()).length, PAGE_KEYS + 48);
});

test('blobs move out of storage.local on first use, without clobbering newer records', async () => {
  const area = memoryStorage();
  const backend = memoryBackend();
  area.data[BLOB_PREFIX + 'plugin:LastSeen'] = { observed: '{"U1":1}', 'cache:x': 'old', '': 'bad' };
  await backend.put('plugin:LastSeen', 'cache:x', 'new');
  const store = createStorage(area, backend);
  assert.equal(await call(store, 'blob.read', 'plugin:LastSeen', 'observed'), '{"U1":1}');
  assert.equal(await call(store, 'blob.read', 'plugin:LastSeen', 'cache:x'), 'new');
  assert.equal(BLOB_PREFIX + 'plugin:LastSeen' in area.data, false);
  assert.deepEqual(await call(store, 'blob.list', 'plugin:LastSeen', ''), ['cache:x', 'observed']);
});
