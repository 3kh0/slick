// Single-file user plugins (`bun run build:plugin`). Each file pushes a factory onto
// `globalThis.__slickPlugins`: the desktop app evaluates the files it stores, web
// builds pick them up from the extension's user scripts or a userscript manager.

import * as slick from '../shared/Plugin.ts';
import type { SlickPluginConstructor } from '../shared/Plugin.ts';

type Factory = (require: (name: string) => unknown) => SlickPluginConstructor | undefined;
const host = { __esModule: true, ...slick };
const global = globalThis as { __slickPlugins?: { push(...factories: Factory[]): unknown } };

function pluginFrom(factory: Factory): SlickPluginConstructor {
  const PluginClass = factory((name) => {
    if (name === '$slick') return host;
    throw new Error(`user plugins can only import $slick, not ${name}`);
  });
  if (!PluginClass) throw new Error('the file has no default-exported plugin class');
  return PluginClass;
}

export function evaluatePlugin(code: string): SlickPluginConstructor {
  // Compiled out of web builds, whose store reviews reject string evaluation.
  if (__SLICK_LOADER__ !== 'electron') throw new Error('user plugins need the desktop app');
  const queue = global.__slickPlugins;
  const found: Factory[] = [];
  global.__slickPlugins = found;
  try {
    new Function(code)();
  } finally {
    global.__slickPlugins = queue;
  }
  if (found.length !== 1 || typeof found[0] !== 'function') throw new Error('That file is not a Slick plugin.');
  return pluginFrom(found[0]);
}

/** Takes the plugins queued before boot, then each one queued after. */
export function adoptPlugins(add: (PluginClass: SlickPluginConstructor) => void): void {
  const take = (factory: Factory) => {
    try {
      add(pluginFrom(factory));
    } catch (error) {
      console.error('[slick] could not load a user plugin:', error);
    }
  };
  const queued = global.__slickPlugins;
  global.__slickPlugins = { push: (...factories) => factories.forEach(take) };
  if (Array.isArray(queued)) queued.forEach(take);
}
