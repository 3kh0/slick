// Slick Desktop Paths
// Where Slick keeps its own state. Deliberately separate from the `userData`
// path handed to Slack (see patch.ts), which is a subdirectory of this one so
// a single directory holds everything Slick owns.

import os from 'node:os';
import path from 'node:path';

/** Slick's config root. Honours SLICK_HANDOFF_PROFILE, as the v1 loader did. */
export function configDir(): string {
  const override = process.env.SLICK_HANDOFF_PROFILE;
  if (override) return path.resolve(override);

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Slick');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Slick');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'slick');
}

/** The Chromium profile Slack runs against. */
export function profileDir(): string {
  return path.join(configDir(), 'profile');
}

/** Slick's own settings live here: settings.json, custom.css, boot.log, ... */
export function settingsDir(): string {
  return path.join(configDir(), 'slick');
}
