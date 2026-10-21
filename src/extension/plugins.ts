import { PLUGINS } from '../plugins/names.generated.ts';

// Every plugin ships to Firefox and Chromium unless it opts out here. Renderer
// halves need no api.fetch and fit their blob quota (see LARGE_STORAGE_PLUGINS);
// privileged halves run in the background (see BACKGROUND_PLUGINS).
export const WEB_EXCLUDED = [
  'BetterGifs', // renderer searches GIF providers through api.fetch, which bridge-setup.ts denies
  'QuietSpotify', // main.ts injects into cross-origin Spotify frames through Electron
] as const;

type WebPlugin = Exclude<(typeof PLUGINS)[number], (typeof WEB_EXCLUDED)[number]>;

export const EXTENSION_PLUGINS = PLUGINS.filter(
  (id): id is WebPlugin => !(WEB_EXCLUDED as readonly string[]).includes(id),
);

// Plugins whose privileged half runs in the extension background: browser.ts
// when present, else main.ts, through extension/mainHost.ts.
export const BACKGROUND_PLUGINS = [
  'ClearURLs',
  'Click2Load',
  'HcaStatus',
  'InstalledApps',
  'NoTrack',
  'PrivateChannelMapper',
] as const satisfies readonly WebPlugin[];

// Plugins whose background half reads slack.com pages with the browser's cookies.
export const SLACK_ACCESS = { origins: ['https://*.slack.com/*'] };
export const SLACK_ACCESS_PLUGINS = ['InstalledApps'] as const satisfies readonly WebPlugin[];

// Plugins with a privileged half whose renderer still works on web targets that don't host it.
export const RENDERER_ONLY_ON_WEB = [
  'AccountSwitcher',
  'AdminBackend',
  'CustomFonts',
  'CustomSounds',
  'NoTrack',
  'ShutUpSlackbot',
  'Snappy',
  'StreamerMode',
] as const satisfies readonly WebPlugin[];

// Plugins whose logs or picked files (app/api/storedFiles.ts) outgrow the
// default blob quota; see extension/blobs.ts.
export const LARGE_STORAGE_PLUGINS = [
  'CustomFonts',
  'CustomSounds',
  'LastSeen',
  'MessageLogger',
] as const satisfies readonly WebPlugin[];
