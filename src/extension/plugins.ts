// Renderer plugins bundled into the Firefox build: no main.ts, no api.fetch,
// and small enough storage for the extension blob quota. Each was checked to
// start cleanly against the live Slack web client (scripts/firefox-smoke.ts).
export const EXTENSION_PLUGINS = [
  'AnonymiseFileNames',
  'bChannel',
  'Censorship',
  'CopyReacted',
  'CustomNameRecording',
  'CustomSlackbot',
  'HumanCount',
  'Nicknames',
  'NotShitMarkdown',
  'oneko',
  'QuickJoin',
  'ShowRealUser',
  'SilentTyping',
  'SlimMessageBox',
  'UserPronouns',
  'WhoReacted',
] as const;
