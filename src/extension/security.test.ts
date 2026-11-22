import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedSender, createBackground, toolbarIconPath } from './background.ts';
import { SETTINGS_KEY, THEME_CSS_KEY } from './storage.ts';
import { installBridge, oneShot } from './bridge-setup.ts';
import { validRequest, validResponse, MAX_TEXT } from './rpc.ts';
import type { ExtensionBrowser } from './rpc.ts';

test('sender must be this extension, top-frame Slack client or owned UI', () => {
  const check = (sender: Parameters<typeof allowedSender>[0]) =>
    allowedSender(sender, 'slick@test', 'moz-extension://own/');
  const sender = { id: 'slick@test', frameId: 0, tab: { id: 1 }, url: 'https://app.slack.com/client/T/C' };
  assert.equal(check(sender), true);
  for (const patch of [
    { id: 'other' },
    { frameId: 1 },
    { frameId: undefined },
    { tab: undefined },
    { url: 'https://app.slack.com/clientevil' },
    { url: 'https://app.slack.com.evil/client' },
    { url: 'http://app.slack.com/client' },
    { url: 'https://app.slack.com:444/client' },
    { url: 'moz-extension://other/options.html' },
    { url: 'invalid' },
  ])
    assert.equal(check({ ...sender, ...patch }), false);
  assert.equal(check({ id: 'slick@test', url: 'moz-extension://own/options.html' }), true);
});
test('no network, cookies, arbitrary plugin calls or unbounded arguments', () => {
  for (const method of ['fetch', 'cookies', 'plugin.call', 'tabs.create', '__proto__'])
    assert.equal(validRequest({ method, args: [] }), false);
  assert.equal(validRequest({ method: 'openCssEditor', args: ['https://evil'] }), false);
  assert.equal(validRequest({ method: 'writeSettings', args: ['x'.repeat(MAX_TEXT + 1)] }), false);
  assert.equal(validRequest({ method: 'blob.read', args: ['plugin:HumanCount', 'x'.repeat(129)] }), false);
  assert.equal(validResponse({ ok: true, value: { x: 1 } }), false);
  assert.equal(validResponse({ ok: false, error: 'x'.repeat(257) }), false);
});
test('UI runtime contract and editor destination are fixed', async () => {
  const opened: string[] = [];
  const api = {
    runtime: { id: 'slick@test', getURL: (path: string) => 'moz-extension://own/' + path },
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
    tabs: {
      create: async ({ url }: { url: string }) => {
        opened.push(url);
      },
    },
  } as unknown as ExtensionBrowser;
  const dispatch = createBackground(api);
  const sender = { id: 'slick@test', url: 'moz-extension://own/options.html' };
  assert.deepEqual(await dispatch({ method: 'openCssEditor', args: [] }, sender), { ok: true, value: true });
  const pageSender = { id: 'slick@test', frameId: 0, tab: { id: 1 }, url: 'https://app.slack.com/client/T/C' };
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await dispatch({ method: 'openCssEditor', args: [] }, pageSender), {
      ok: false,
      error: 'Use the Slick toolbar to open options',
    });
  }
  assert.deepEqual(opened, ['moz-extension://own/options.html']);
  assert.deepEqual(await dispatch({ method: 'fetch', args: [] }, sender), { ok: false, error: 'Request denied' });
  assert.deepEqual(await dispatch({ method: 'readUserCss', args: [] }, sender), { ok: true, value: '' });
});
test('one-shot claim, bypass and safe mode without runtime bridge import', async () => {
  const claim = oneShot({ value: 1 });
  assert.deepEqual(claim(), { value: 1 });
  assert.equal(claim(), null);
  function target(prefs: Record<string, string>) {
    const t = {
      location: { origin: 'https://app.slack.com', pathname: '/client/T' },
      sessionStorage: { getItem: (key: string) => prefs[key] ?? null },
      addEventListener: () => {},
      postMessage: () => {},
    } as unknown as Window & typeof globalThis;
    Object.defineProperty(t, 'top', { value: t });
    return t;
  }
  const bypass = target({ 'slick:firefox:bypass': '1' });
  installBridge(bypass);
  assert.equal('SlickBridge' in bypass, false);
  const safe = target({ 'slick:firefox:safe-mode': '1' });
  installBridge(safe);
  const exposed = (safe as unknown as { SlickBridge: { claim(): import('../app/bridge.ts').SlickBridge | null } })
    .SlickBridge;
  const bridge = exposed.claim()!;
  assert.equal(bridge.safeMode, true);
  assert.equal(exposed.claim(), null);
  await assert.rejects(bridge.openCssEditor(), /toolbar/);
  await assert.rejects(bridge.fetch('https://example.com'));
  await assert.rejects(bridge.plugin('Censorship').call('anything'));
  assert.throws(() => bridge.blobStore('plugin:../Other'));
  assert.throws(() => bridge.blobStore('user-plugins'));
  assert.doesNotThrow(() => bridge.blobStore('plugin:HumanCount'));
});

test('toolbar icon follows settings; unknown or missing choices fall back to the theme icons', async () => {
  assert.equal(toolbarIconPath('{"toolbarIcon":"white"}'), 'icons/white.svg');
  assert.equal(toolbarIconPath('{"toolbarIcon":"black"}'), 'icons/black.svg');
  for (const settings of ['{"toolbarIcon":"auto"}', '{"toolbarIcon":"../x.svg"}', '{}', 'not json', undefined])
    assert.equal(toolbarIconPath(settings), null);

  const icons: (string | null)[] = [];
  let onChanged!: (changes: Record<string, { newValue?: unknown }>, area: string) => void;
  const api = {
    runtime: { id: 'slick@test', getURL: (path: string) => 'moz-extension://own/' + path },
    storage: {
      local: { get: async () => ({ [SETTINGS_KEY]: '{"toolbarIcon":"white"}' }), set: async () => {} },
      onChanged: { addListener: (cb: typeof onChanged) => (onChanged = cb) },
    },
    tabs: { create: async () => {} },
    action: { setIcon: async ({ path }: { path: string | null }) => void icons.push(path) },
  } as unknown as ExtensionBrowser;
  createBackground(api);
  await new Promise((resolve) => setTimeout(resolve, 0));
  onChanged({ [SETTINGS_KEY]: { newValue: '{"toolbarIcon":"auto"}' } }, 'local');
  onChanged({ [SETTINGS_KEY]: { newValue: '{"toolbarIcon":"black"}' } }, 'sync');
  assert.deepEqual(icons, ['icons/white.svg', null]);
});

test('Chromium owned UI accepts only this extension origin', async () => {
  const root = 'chrome-extension://abcdefghijklmnop/';
  const sender = { id: 'slick@test', url: root + 'options.html' };
  assert.equal(allowedSender(sender, 'slick@test', root), true);
  for (const url of [
    'chrome-extension://other/options.html',
    'moz-extension://abcdefghijklmnop/options.html',
    'https://abcdefghijklmnop/options.html',
  ]) {
    assert.equal(allowedSender({ ...sender, url }, 'slick@test', root), false);
  }
  const opened: string[] = [];
  const api = {
    runtime: { id: 'slick@test', getURL: (p: string) => root + p },
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
    tabs: {
      create: async ({ url }: { url: string }) => {
        opened.push(url);
      },
    },
  } as unknown as ExtensionBrowser;
  assert.deepEqual(await createBackground(api)({ method: 'openCssEditor', args: [] }, sender), {
    ok: true,
    value: true,
  });
  assert.deepEqual(opened, [root + 'options.html']);
  assert.equal(toolbarIconPath('{"toolbarIcon":"white"}', true), 'icons/white.png');
});
test('a settings write reaches background halves before storage.onChanged does', async () => {
  const data: Record<string, unknown> = {};
  const area = {
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(data, items),
  };
  const api = {
    runtime: { id: 'slick@test', getURL: (path: string) => 'moz-extension://own/' + path },
    storage: { local: area, onChanged: { addListener() {} } },
    tabs: {},
  } as unknown as ExtensionBrowser;
  const plugin = { id: 'ClearURLs', capabilities: [], rpc: { rules: () => 'ok' } };
  const dispatch = createBackground(api, [{ plugin, schema: {}, defaultEnabled: false }], {} as never);
  const sender = { id: 'slick@test', url: 'moz-extension://own/options.html' };
  const call = () => dispatch({ method: 'plugin.call', args: ['ClearURLs', 'rules', '[]'] }, sender);
  assert.equal((await call()).ok, false);
  const prior = (await dispatch({ method: 'readSettings', args: [] }, sender)) as { value: string };
  const next = JSON.stringify({ plugins: { ClearURLs: { enabled: true } } });
  assert.deepEqual(await dispatch({ method: 'compareAndSwapSettings', args: [prior.value, next] }, sender), {
    ok: true,
    value: true,
  });
  assert.deepEqual(await call(), { ok: true, value: '"ok"' });
});

test('background keeps cached theme CSS and dynamic snappy-boot script in sync', async () => {
  const data: Record<string, unknown> = {
    [SETTINGS_KEY]: JSON.stringify({
      theme: 'mocha',
      plugins: { Snappy: { enabled: true, optimizeStateTracking: true } },
    }),
  };
  let registered: Record<string, unknown>[] = [];
  const api = {
    runtime: { id: 'slick@test', getURL: (path: string) => 'moz-extension://own/' + path },
    storage: {
      local: {
        get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
        set: async (items: Record<string, unknown>) => void Object.assign(data, items),
        remove: async (key: string) => void delete data[key],
      },
      onChanged: { addListener() {} },
    },
    tabs: {},
    scripting: {
      getRegisteredContentScripts: async () => registered.map((s) => ({ id: s.id })),
      registerContentScripts: async (scripts: Record<string, unknown>[]) => {
        registered.push(...scripts);
      },
      unregisterContentScripts: async ({ ids }: { ids: string[] }) => {
        registered = registered.filter((s) => !ids.includes(String(s.id)));
      },
    },
  } as unknown as ExtensionBrowser;

  const themes = () => ({ mocha: { name: 'Mocha', mode: 'dark' as const, vars: { '--bg': '#1e1e2e' } } });
  const dispatch = createBackground(api, [], {} as never, undefined, themes);
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(data[THEME_CSS_KEY], {
    css: ':root,html,body,.sk-client-theme--dark,.sk-client-theme--light{--bg:#1e1e2e !important}\n',
    mode: 'dark',
  });
  assert.equal(registered.length, 1);
  assert.equal(registered[0].id, 'snappy-boot');
  assert.deepEqual(registered[0].js, ['snappy-boot.js']);
  assert.equal(registered[0].world, 'MAIN');
  assert.equal(registered[0].runAt, 'document_start');

  const sender = { id: 'slick@test', url: 'moz-extension://own/options.html' };
  const prior = (await dispatch({ method: 'readSettings', args: [] }, sender)) as { value: string };
  const next = JSON.stringify({
    theme: '',
    plugins: { Snappy: { enabled: true, optimizeStateTracking: false } },
  });
  assert.deepEqual(await dispatch({ method: 'compareAndSwapSettings', args: [prior.value, next] }, sender), {
    ok: true,
    value: true,
  });
  assert.equal(THEME_CSS_KEY in data, false);
  assert.equal(registered.length, 0);
});

test('installBridge transfers one MessageChannel port and closes it on final pagehide', async () => {
  const posts: { message: unknown; transfer?: unknown[] }[] = [];
  const listeners = new Map<string, (ev: unknown) => void>();
  const port1Sent: unknown[] = [];
  const port1Handlers: ((ev: { data: unknown }) => void)[] = [];
  let port1Closed = false;
  let port1Started = false;
  const fakePort1 = {
    addEventListener: (_type: string, cb: (ev: { data: unknown }) => void) => port1Handlers.push(cb),
    start: () => {
      port1Started = true;
    },
    postMessage: (m: unknown) => port1Sent.push(m),
    close: () => {
      port1Closed = true;
    },
  };
  const fakePort2 = {};
  const target = {
    location: { origin: 'https://app.slack.com', pathname: '/client/T' },
    sessionStorage: { getItem: () => null },
    MessageChannel: function FakeMessageChannel() {
      return { port1: fakePort1, port2: fakePort2 };
    },
    addEventListener: (name: string, cb: (ev: unknown) => void) => listeners.set(name, cb),
    postMessage: (message: unknown, _origin: string, transfer?: unknown[]) => posts.push({ message, transfer }),
  } as unknown as Window & typeof globalThis;
  Object.defineProperty(target, 'top', { value: target });

  installBridge(target);
  assert.equal(port1Started, true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].transfer?.[0], fakePort2);

  const bridge = (
    target as unknown as { SlickBridge: { claim(): import('../app/bridge.ts').SlickBridge } }
  ).SlickBridge.claim();
  const pending = bridge.readSettings();
  assert.equal(port1Sent.length, 1);
  const req = port1Sent[0] as { id: string };
  for (const cb of port1Handlers) {
    cb({
      data: { channel: 'slick:firefox:v1', kind: 'response', id: req.id, response: { ok: true, value: '{}' } },
    });
  }
  assert.equal(await pending, '{}');

  listeners.get('pagehide')!({ persisted: false });
  assert.equal(port1Closed, true);
});
