// Plugins bundled into the Firefox build. Renderer halves need no api.fetch and
// fit the extension blob quota; privileged halves run in the background (see
// BACKGROUND_PLUGINS). Each was checked to start cleanly against the live Slack
// web client (scripts/firefox-smoke.ts).
export const EXTENSION_PLUGINS = [
  'AnonymiseFileNames',
  'bChannel',
  'Censorship',
  'ClearURLs',
  'Click2Load',
  'CopyReacted',
  'CustomNameRecording',
  'CustomSlackbot',
  'HumanCount',
  'Nicknames',
  'NoTrack',
  'NotShitMarkdown',
  'oneko',
  'QuickJoin',
  'ShowRealUser',
  'SilentTyping',
  'SlimMessageBox',
  'UserPronouns',
  'WhoReacted',
] as const;

/**
 * Plugins whose privileged half runs in the extension background: browser.ts
 * when present, else main.ts, through extension/mainHost.ts.
 */
export const BACKGROUND_PLUGINS = ['ClearURLs', 'Click2Load', 'NoTrack'] as const;
