import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedSender, createBackground } from './background.ts';
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
    storage: { local: { get: async () => ({}), set: async () => {} } },
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
  assert.throws(() => bridge.blobStore('plugin:Other'));
  assert.doesNotThrow(() => bridge.blobStore('plugin:HumanCount'));
});
