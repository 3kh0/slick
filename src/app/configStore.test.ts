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

test('desktop theme imports persist separately from CSS, survive restart, and remove cleanly', async () => {
  let stored = '{"theme":"amoled","plugins":{"HumanCount":{"enabled":true}}}';
  let succeeds = true;
  const bridge = {
    readSettings: async () => stored,
    readUserCss: async () => 'body { color: red; }',
    writeSettings: async (text: string) => {
      if (!succeeds) return false;
      stored = text;
      return true;
    },
    onSettingsChange: () => () => {},
    onUserCssChange: () => () => {},
  } as unknown as SlickBridge;
  const config = new ConfigStore(bridge);
  await config.init();
  const theme = { name: 'Latte', vars: { '--accent': '#8839ef' } };
  succeeds = false;
  assert.equal(await config.importTheme('imported:latte', theme), false);
  assert.equal(config.theme, 'amoled');
  assert.deepEqual(config.importedThemes, {});
  succeeds = true;
  let notifications = 0;
  config.onConfigChange(() => notifications++);
  assert.equal(await config.importTheme('imported:latte', theme), true);
  assert.equal(notifications, 1);
  assert.equal(config.theme, 'imported:latte');
  assert.equal(config.getUserCss(), 'body { color: red; }');
  assert.equal(JSON.parse(stored).plugins.HumanCount.enabled, true);
  const restarted = new ConfigStore(bridge);
  await restarted.init();
  assert.deepEqual(restarted.importedThemes['imported:latte'], theme);
  assert.equal(restarted.theme, 'imported:latte');
  assert.equal(await restarted.removeTheme('imported:latte'), true);
  assert.equal(restarted.theme, '');
  assert.deepEqual(restarted.importedThemes, {});
});

test('workspace selections persist independently of plugin schemas and toggles', async () => {
  let stored = JSON.stringify({ plugins: { HaikuWarning: { enabled: true, extra: 12 } } });
  const bridge = {
    readSettings: async () => stored,
    readUserCss: async () => '',
    writeSettings: async (text: string) => {
      stored = text;
      return true;
    },
    onSettingsChange: () => () => {},
    onUserCssChange: () => () => {},
  } as unknown as SlickBridge;
  const config = new ConfigStore(bridge);
  await config.init();
  config.registerSchema('HaikuWarning', {}, false);
  assert.equal(config.workspacesFor('HaikuWarning'), null);
  assert.equal(await config.setPluginWorkspaces('HaikuWarning', ['T1']), true);
  assert.equal(config.isAllowedInWorkspace('HaikuWarning', 'T1'), true);
  assert.equal(config.isAllowedInWorkspace('HaikuWarning', 'T2'), false);
  assert.equal(config.isAllowedInWorkspace('HaikuWarning', null), false);
  assert.equal(config.settingsFor('HaikuWarning').enabled, true);
  await Promise.all([
    config.setPluginWorkspace('HaikuWarning', 'T2', true),
    config.setPluginWorkspace('HaikuWarning', 'T3', true),
  ]);
  assert.deepEqual(config.workspacesFor('HaikuWarning'), ['T1', 'T2', 'T3']);
  await config.setPluginEnabled('HaikuWarning', false);
  await config.setPluginEnabled('HaikuWarning', true);
  assert.deepEqual(config.workspacesFor('HaikuWarning'), ['T1', 'T2', 'T3']);
  const reloaded = new ConfigStore(bridge);
  await reloaded.init();
  assert.deepEqual(reloaded.workspacesFor('HaikuWarning'), ['T1', 'T2', 'T3']);
  assert.equal(JSON.parse(stored).plugins.HaikuWarning.extra, 12);
  await config.setPluginWorkspaces('HaikuWarning', []);
  assert.equal(config.isAllowedInWorkspace('HaikuWarning', 'T1'), false);
  await config.setPluginWorkspaces('HaikuWarning', null);
  assert.equal(config.isAllowedInWorkspace('HaikuWarning', 'T2'), true);
  assert.equal(await config.setPluginWorkspaces('Snappy', ['T1']), false);
});
