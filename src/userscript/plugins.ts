import { EXTENSION_PLUGINS } from '../extension/plugins.ts';

// Cookie/session replacement and browser-wide request blocking require extension
// APIs. Don't present controls that cannot work through Violentmonkey's GM APIs.
export const USERSCRIPT_PLUGINS = EXTENSION_PLUGINS.filter(
  (id) => !(['AccountSwitcher', 'Click2Load', 'NoTrack'] as readonly string[]).includes(id),
);
export const USERSCRIPT_MAIN_PLUGINS = ['ClearURLs', 'HcaStatus', 'PrivateChannelMapper'] as const;
