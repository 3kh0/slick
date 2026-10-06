import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GMApi } from './gm.ts';
import { createUserscriptBridge, installUserscriptBridge, BYPASS, SAFE_MODE } from './bridge.ts';
import { createBlobStore, CSS, SETTINGS, validSettings } from './storage.ts';
import { gmFetch } from './network.ts';

function memoryGm() {
  const values = new Map<string, unknown>();
  const listeners = new Map<number, { key: string; callback: Parameters<GMApi['watch']>[1] }>();
  const menus = new Map<string, () => void>();
  let nextId = 0;
  let request: Parameters<GMApi['request']>[0] | undefined;
  const gm: GMApi = {
    get: (key, fallback) => (values.has(key) ? values.get(key) : fallback) as typeof fallback,
    async set(key, value) {
      const old = values.get(key);
      values.set(key, value);
      for (const listener of listeners.values()) if (listener.key === key) listener.callback(key, old, value, false);
    },
    async delete(key) {
      values.delete(key);
    },
    list: () => [...values.keys()],
    watch(key, callback) {
      const id = ++nextId;
      listeners.set(id, { key, callback });
      return id;
    },
    unwatch: (id) => {
      listeners.delete(id);
    },
    menu: (label, callback) => {
      menus.set(label, callback);
    },
    request: (options) => {
      request = options;
    },
  };
  return { gm, values, menus, listeners, request: () => request! };
}

test('blob namespaces survive bridge recreation and clearing one does not remove another', async () => {
  const { gm } = memoryGm();
  const a = createBlobStore(gm, 'plugin:CustomFonts');
  const b = createBlobStore(gm, 'plugin:CustomSounds');
  await a.write('file:font', 'data:font/woff2;base64,AA==');
  await b.write('file:sound', 'data:audio/ogg;base64,AA==');
  assert.deepEqual(await createBlobStore(gm, 'plugin:CustomFonts').readAll('file:'), {
    'file:font': 'data:font/woff2;base64,AA==',
  });
  await a.clear();
  assert.deepEqual(await a.list(), []);
  assert.equal(await b.read('file:sound'), 'data:audio/ogg;base64,AA==');
  assert.throws(() => createBlobStore(gm, '../settings'), /namespace/);
});

test('settings use acknowledged GM writes, reject malformed imports, and remove listeners on disposal', async () => {
  const { gm, values, listeners } = memoryGm();
  const bridge = createUserscriptBridge(gm);
  const defaults = JSON.parse(await bridge.readSettings());
  assert.equal(Object.keys(defaults.plugins).length, 32);
  assert.ok(Object.values(defaults.plugins).every((p: any) => !p.enabled));
  for (const id of ['AccountSwitcher', 'Click2Load', 'NoTrack']) assert.equal(defaults.plugins[id], undefined);
  let notified = '';
  const stop = bridge.onSettingsChange((text) => {
    notified = text;
  });
  const settings = '{"plugins":{"oneko":{"enabled":true}}}';
  assert.equal(await bridge.writeSettings(settings), true);
  assert.equal(values.get(SETTINGS), settings);
  assert.equal(notified, settings);
  assert.equal(await createUserscriptBridge(gm).readSettings(), settings);
  for (const bad of ['null', '[]', 'false', '{broken']) {
    assert.equal(validSettings(bad), false);
    assert.equal(await bridge.writeSettings(bad), false);
    assert.equal(values.get(SETTINGS), settings);
  }
  const count = listeners.size;
  stop();
  assert.equal(listeners.size, count - 1);
  await bridge.writeUserCss('body { color: red; }');
  assert.equal(values.get(CSS), await bridge.readUserCss());
  assert.equal(bridge.onOpenSettings, undefined, 'settings belong in native Slack Preferences');
});

test('cross-origin networking uses GM without sending browser cookies and reports failures', async () => {
  const { gm, request } = memoryGm();
  const response = gmFetch(gm, 'https://example.org/blob', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'hello',
  });
  assert.equal(request().anonymous, true);
  assert.equal(request().data, 'hello');
  assert.equal(request().headers['content-type'], 'text/plain');
  request().onload({ status: 404, responseText: 'missing' });
  assert.deepEqual(await response, { status: 404, body: 'missing' });
  const failed = gmFetch(gm, 'https://example.org/asset');
  request().ontimeout();
  await assert.rejects(failed, /timed out/);
  await assert.rejects(gmFetch(gm, 'file:///etc/passwd'), /Unsupported/);
  await assert.rejects(gmFetch(gm, 'https://example.org/', { body: new Blob(['x']) }), /text/);
});

test('recovery survives bypass, safe mode does not erase settings, and the bridge is claimed once', () => {
  const { gm, menus, values } = memoryGm();
  const storage = new Map<string, string>();
  let reloads = 0;
  const target: any = {
    location: {
      origin: 'https://app.slack.com',
      pathname: '/client/T/C',
      reload: () => {
        reloads++;
      },
    },
    sessionStorage: {
      getItem: (key: string) => storage.get(key),
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  };
  target.top = target;
  values.set(SETTINGS, '{"plugins":{"oneko":{"enabled":true}}}');
  storage.set(BYPASS, '1');
  installUserscriptBridge(target, gm);
  assert.equal(target.SlickBridge, undefined);
  menus.get('Toggle Slick bypass and reload')!();
  assert.equal(storage.has(BYPASS), false);
  assert.equal(reloads, 1);
  storage.set(SAFE_MODE, '1');
  installUserscriptBridge(target, gm);
  const bridge = target.SlickBridge.claim();
  assert.equal(bridge.safeMode, true);
  assert.equal(target.SlickBridge.claim(), null);
  assert.equal(values.get(SETTINGS), '{"plugins":{"oneko":{"enabled":true}}}');
  assert.deepEqual([...menus.keys()], ['Toggle Slick bypass and reload', 'Toggle Slick safe mode and reload']);
});

test('privileged plugin halves use GM networking and stop in safe mode', async () => {
  const { gm, values, request } = memoryGm();
  values.set(SETTINGS, '{"plugins":{"Probe":{"enabled":true}}}');
  const plugins: import('../extension/mainHost.ts').BackgroundPlugin[] = [
    {
      plugin: {
        id: 'Probe',
        capabilities: ['net'],
        rpc: { load: (ctx: import('../shared/main.ts').MainCtx) => ctx.net.fetch('https://example.org/rules.json') },
      },
      schema: {},
      defaultEnabled: false,
    },
  ];
  const bridge = createUserscriptBridge(gm, plugins);
  const loaded = bridge.plugin('Probe').call('load');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(request().url, 'https://example.org/rules.json');
  request().onload({ status: 200, responseText: '{}' });
  assert.deepEqual(await loaded, { status: 200, body: '{}' });
  const safe = createUserscriptBridge(gm, plugins, true);
  await assert.rejects(safe.plugin('Probe').call('load'), /disabled/);
});
