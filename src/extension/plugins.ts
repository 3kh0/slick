// Plugins bundled into the Firefox build. Renderer halves need no api.fetch and
// fit their blob quota (see LARGE_STORAGE_PLUGINS); privileged halves run in the
// background (see BACKGROUND_PLUGINS). Each was checked to start cleanly against the live Slack
// web client (scripts/firefox-smoke.ts).
export const EXTENSION_PLUGINS = [
  'AdminBackend',
  'AnonymiseFileNames',
  'bChannel',
  'Censorship',
  'ClearURLs',
  'Click2Load',
  'CopyReacted',
  'CustomNameRecording',
  'CustomSlackbot',
  'HcaStatus',
  'HumanCount',
  'LastSeen',
  'MessageLogger',
  'Nicknames',
  'NoTrack',
  'NotShitMarkdown',
  'OfficeHours',
  'oneko',
  'PrivateChannelMapper',
  'QuickJoin',
  'ShowRealUser',
  'SilentTyping',
  'SlimMessageBox',
  'StreamerMode',
  'UserPronouns',
  'WhoReacted',
] as const;

// Plugins whose privileged half runs in the extension background: browser.ts
// when present, else main.ts, through extension/mainHost.ts.
export const BACKGROUND_PLUGINS = ['ClearURLs', 'Click2Load', 'HcaStatus', 'NoTrack', 'PrivateChannelMapper'] as const;

// Plugins whose logs outgrow the default blob quota; see extension/blobs.ts.
export const LARGE_STORAGE_PLUGINS = ['LastSeen', 'MessageLogger'] as const;
