import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigStore } from './configStore.ts';
import type { SlickBridge } from './bridge.ts';
import { memoryBackend } from '../extension/blobs.ts';
import { createStorage } from '../extension/storage.ts';

test('CAS retries preserve concurrent tab updates and queued same-tab mutations', async () => {
  const data: Record<string, unknown> = {};
  const storage = createStorage(
    {
      get: async () => structuredClone(data),
      set: async (items) => {
        Object.assign(data, items);
      },
      remove: async () => {},
    },
    memoryBackend(),
  );
  const call = async (method: string, args: string[] = []) => {
    const response = await storage.dispatch({ method, args });
    if (!response.ok) throw new Error(response.error);
    return response.value;
  };
  const bridge = {
    readSettings: () => call('readSettings'),
    readUserCss: async () => '',
    compareAndSwapSettings: (prior: string, text: string) => call('compareAndSwapSettings', [prior, text]),
    onSettingsChange: () => () => {},
    onUserCssChange: () => () => {},
  } as unknown as SlickBridge;
  const a = new ConfigStore(bridge);
  const b = new ConfigStore(bridge);
  await Promise.all([a.init(), b.init()]);
  assert.deepEqual(
    await Promise.all([
      a.setTheme('dark'),
      b.setPluginEnabled('HumanCount', true),
      a.setPluginEnabled('Censorship', true),
    ]),
    [true, true, true],
  );
  const saved = JSON.parse(await bridge.readSettings());
  assert.equal(saved.theme, 'dark');
  assert.equal(saved.plugins.HumanCount.enabled, true);
  assert.equal(saved.plugins.Censorship.enabled, true);
});

test('CAS contention is bounded and failed writes do not install drafts', async () => {
  let attempts = 0;
  const bridge = {
    readSettings: async () => '{"theme":"old"}',
    readUserCss: async () => '',
    compareAndSwapSettings: async () => {
      attempts++;
      return false;
    },
    onSettingsChange: () => () => {},
    onUserCssChange: () => () => {},
  } as unknown as SlickBridge;
  const config = new ConfigStore(bridge);
  await config.init();
  assert.equal(await config.setTheme('new'), false);
  assert.equal(attempts, 8);
  assert.equal(config.theme, 'old');
});

test('initial settings and CSS reads begin together and retain their values', async () => {
  let releaseSettings!: (value: string) => void;
  let releaseCss!: (value: string) => void;
  const started: string[] = [];
  const bridge = {
    readSettings: () => {
      started.push('settings');
      return new Promise<string>((resolve) => (releaseSettings = resolve));
    },
    readUserCss: () => {
      started.push('css');
      return new Promise<string>((resolve) => (releaseCss = resolve));
    },
    onSettingsChange: () => () => {},
    onUserCssChange: () => () => {},
  } as unknown as SlickBridge;
  const config = new ConfigStore(bridge);
  const ready = config.init();
  assert.deepEqual(started, ['settings', 'css']);
  releaseCss('body { color: red; }');
  releaseSettings('{"theme":"amoled"}');
  await ready;
  assert.equal(config.theme, 'amoled');
  assert.equal(config.getUserCss(), 'body { color: red; }');
});

test('renamed themes map to their replacement', async () => {
  const bridge = {
    readSettings: async () => '{"theme":"ultraviolet"}',
    readUserCss: async () => '',
    onSettingsChange: () => () => {},
    onUserCssChange: () => () => {},
  } as unknown as SlickBridge;
  const config = new ConfigStore(bridge);
  await config.init();
  assert.equal(config.theme, 'catppuccin-mocha');
});

test('failed CSS read still falls back without losing valid settings', async () => {
  const bridge = {
    readSettings: async () => '{"theme":"catppuccin-mocha"}',
    readUserCss: async () => {
      throw new Error('unavailable');
    },
    onSettingsChange: () => () => {},
    onUserCssChange: () => () => {},
  } as unknown as SlickBridge;
  const config = new ConfigStore(bridge);
  await config.init();
  assert.equal(config.theme, 'catppuccin-mocha');
  assert.equal(config.getUserCss(), '');
});
