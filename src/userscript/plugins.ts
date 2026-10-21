import { EXTENSION_PLUGINS } from '../extension/plugins.ts';

// Cookie/session replacement and browser-wide request blocking require extension
// APIs. Don't present controls that cannot work through Violentmonkey's GM APIs.
export const USERSCRIPT_EXCLUDED: readonly string[] = ['AccountSwitcher', 'Click2Load'];

export const USERSCRIPT_PLUGINS = EXTENSION_PLUGINS.filter((id) => !USERSCRIPT_EXCLUDED.includes(id));

export const USERSCRIPT_MAIN_PLUGINS = [
  'BetterGifs',
  'ClearURLs',
  'HcaStatus',
  'InstalledApps',
  'PrivateChannelMapper',
] as const satisfies readonly (typeof USERSCRIPT_PLUGINS)[number][];
