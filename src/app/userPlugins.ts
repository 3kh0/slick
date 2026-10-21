// Single-file user plugins (`bun run build:plugin`), kept in the blob store and
// evaluated at boot. Desktop only: Slack's web CSP forbids evaluating them.

import * as slick from '../shared/Plugin.ts';
import type { SlickPluginConstructor } from '../shared/Plugin.ts';

const host = { __esModule: true, ...slick };

export function evaluatePlugin(code: string): SlickPluginConstructor {
  // Compiled out of web builds, whose store reviews reject string evaluation.
  if (__SLICK_LOADER__ !== 'electron') throw new Error('user plugins need the desktop app');
  const module = { exports: {} as { default?: SlickPluginConstructor } };
  new Function('module', 'exports', 'require', code)(module, module.exports, (name: string) => {
    if (name === '$slick') return host;
    throw new Error(`user plugins can only import $slick, not ${name}`);
  });
  if (!module.exports.default) throw new Error('the file has no default-exported plugin class');
  return module.exports.default;
}
