// Config store -> plugin manager -> plugins, then hand back to Slack.

import { setStyle } from './api/css.ts';
import type { SlickBridge } from './bridge.ts';
import { ConfigStore } from './configStore.ts';
import { PluginManager } from './pluginManager.ts';
import { addSettingsTab } from './settings.tsx';
import { installTheme } from './theme.ts';

/** Injected by esbuild: { PluginName: "<bundled iife source>" }. */
declare const __SLICK_PLUGINS__: Record<string, string>;

export async function bootstrap(bridge: SlickBridge): Promise<void> {
  const config = new ConfigStore(bridge);
  await config.init();

  installTheme(config);
  setStyle(config.getUserCss(), 'user');
  config.onUserCssChange((css) => setStyle(css, 'user'));

  const manager = new PluginManager(bridge, config);
  (globalThis as any).__slickPluginManager = manager;

  if (bridge.safeMode) {
    console.warn('[slick] safe mode: no plugins will be registered');
    await addSettingsTab(manager, config, bridge);
    return;
  }

  const registered: string[] = [];
  for (const [name, code] of Object.entries(__SLICK_PLUGINS__)) {
    const id = manager.register(code);
    if (id) registered.push(id);
    else console.error(`[slick] could not register plugin: ${name}`);
  }

  await manager.reconcile();
  await addSettingsTab(manager, config, bridge);

  const running = manager.info().filter((plugin) => plugin.running);
  console.log(
    `[slick] ${running.length}/${registered.length} plugins running${
      running.length ? `: ${running.map((plugin) => plugin.id).join(', ')}` : ''
    }`,
  );
}
