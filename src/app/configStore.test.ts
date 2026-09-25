import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigStore } from './configStore.ts';
import type { SlickBridge } from './bridge.ts';

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

test('failed CSS read still falls back without losing valid settings', async () => {
  const bridge = {
    readSettings: async () => '{"theme":"ultraviolet"}',
    readUserCss: async () => {
      throw new Error('unavailable');
    },
    onSettingsChange: () => () => {},
    onUserCssChange: () => () => {},
  } as unknown as SlickBridge;
  const config = new ConfigStore(bridge);
  await config.init();
  assert.equal(config.theme, 'ultraviolet');
  assert.equal(config.getUserCss(), '');
});
