import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStorage, DEFAULT_SETTINGS, SETTINGS_KEY, CSS_KEY, BLOB_PREFIX } from './storage.ts';
import { MAX_BLOB, MAX_KEYS, MAX_TEXT, RENDERERS } from './rpc.ts';
import type { StorageArea } from './rpc.ts';
export function memoryStorage(): StorageArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async () => structuredClone(data),
    set: async (items) => {
      Object.assign(data, structuredClone(items));
    },
  };
}
test('default-off config, JSON validation, CSS and storage constants', async () => {
  const area = memoryStorage();
  const store = createStorage(area);
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
  const store = createStorage(memoryStorage());
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
  const store = createStorage(area);
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
  assert.deepEqual(await store.dispatch({ method: 'blob.list', args: ['plugin:HumanCount'] }), { ok: true, value: [] });
  assert.ok(area.data[BLOB_PREFIX + 'plugin:Censorship']);
  await store.dispatch({ method: 'blob.clear', args: ['plugin:Censorship'] });
  for (let i = 0; i < MAX_KEYS; i++)
    await store.dispatch({ method: 'blob.write', args: ['plugin:Censorship', String(i), 'v'] });
  assert.equal(
    (await store.dispatch({ method: 'blob.write', args: ['plugin:Censorship', 'overflow', 'v'] })).ok,
    false,
  );
});
