// configDir holds everything Slick owns: Slack's userData (profileDir, see
// patch.ts) and Slick's own state (settingsDir).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Honours SLICK_HANDOFF_PROFILE (v1's override name). */
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
 * The Chromium profile Slack runs against. v1 used the config root itself, so
 * a root `Local State` with no `profile/` means a v1 profile, kept in place so
 * upgrading doesn't sign users out.
 */
export function profileDir(): string {
  const root = configDir();
  const profile = path.join(root, 'profile');
  if (!fs.existsSync(profile) && fs.existsSync(path.join(root, 'Local State'))) return root;
  return profile;
}

/** settings.json, custom.css, boot.log, ... */
export function settingsDir(): string {
  return path.join(configDir(), 'slick');
}
