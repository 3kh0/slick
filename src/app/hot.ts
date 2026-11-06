import type { SlickPluginConstructor } from '../shared/Plugin.ts';
import type { SlickBridge } from './bridge.ts';
import type { PluginManager } from './pluginManager.ts';

export function installHot(bridge: SlickBridge, manager: PluginManager): void {
  const modules: Map<string, object> | undefined = (globalThis as any).__slickHostModules;
  if (!modules || !bridge.onHotUpdate) return;

  (globalThis as any).__slickHot = {
    module(key: string) {
      const ns = modules.get(key);
      if (!ns) throw new Error(`[slick] hot: ${key} is not in slick.js yet; reload to pick it up`);
      return '__esModule' in ns ? ns : Object.defineProperty(ns, '__esModule', { value: true });
    },
    accept: (P: SlickPluginConstructor) =>
      manager.replace(P).catch((error) => console.error('[slick] hot reload failed:', error)),
  };

  bridge.onHotUpdate((url) => {
    const s = document.createElement('script');
    s.src = url;
    for (const event of ['load', 'error']) s.addEventListener(event, () => s.remove());
    document.head.append(s);
  });
  console.log('[slick] hot reload enabled');
}
