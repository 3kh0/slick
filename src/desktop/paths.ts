// Slick Desktop Paths
// Where Slick keeps its own state. Deliberately separate from the `userData`
// path handed to Slack (see patch.ts), which is a subdirectory of this one so
// a single directory holds everything Slick owns.

import fs from 'node:fs';
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

/**
 * The Chromium profile Slack runs against.
 *
 * v1 used the config root itself as Chromium's userData, so an existing
 * install has its cookies, IndexedDB and Local Storage there rather than in
 * `profile/`. Switching directories on upgrade would sign every v1 user out and
 * drop Slack's local cache, so a v1 profile keeps being used where it is. It is
 * recognised by Chromium's `Local State` file at the root, and only while no
 * v2 profile exists -- once `profile/` does, that is the one in use.
 */
export function profileDir(): string {
  const root = configDir();
  const profile = path.join(root, 'profile');
  if (!fs.existsSync(profile) && fs.existsSync(path.join(root, 'Local State'))) return root;
  return profile;
}

/** Slick's own settings live here: settings.json, custom.css, boot.log, ... */
export function settingsDir(): string {
  return path.join(configDir(), 'slick');
}
