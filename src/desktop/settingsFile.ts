// Slick Settings File
//
// Reading and watching settings.json from the main process. Watching the
// *directory* rather than the file is deliberate: editors and Slick's own
// writes replace the file by rename, and an fs.watch on the path itself stops
// firing the moment the inode it was opened against goes away. v1 learned this
// in scripts/byoe/watch.js.

import fs from 'node:fs';
import path from 'node:path';
import { settingsDir } from './paths.js';

const SETTINGS_FILE = 'settings.json';
const DEBOUNCE_MS = 150;

export type StoredPlugins = Record<string, Record<string, unknown>> | undefined;

export function readSettingsText(): string {
  try {
    return fs.readFileSync(path.join(settingsDir(), SETTINGS_FILE), 'utf8');
  } catch {
    return '{}';
  }
}

export function readStoredPlugins(): StoredPlugins {
  try {
    const parsed = JSON.parse(readSettingsText());
    if (!parsed || typeof parsed !== 'object') return undefined;
    const plugins = parsed.plugins;
    return plugins && typeof plugins === 'object' && !Array.isArray(plugins) ? plugins : undefined;
  } catch {
    // A hand-edited settings file is routine, and a syntax error in it must
    // not take the app down; the previous resolved settings stay in effect.
    console.error('[slick] settings.json is not valid JSON; ignoring this change');
    return undefined;
  }
}

export function watchSettings(onChange: (text: string, plugins: StoredPlugins) => void): () => void {
  const dir = settingsDir();
  fs.mkdirSync(dir, { recursive: true });

  let timer: NodeJS.Timeout | null = null;
  const fire = () => {
    timer = null;
    onChange(readSettingsText(), readStoredPlugins());
  };

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(dir, (_event, filename) => {
      if (filename && filename !== SETTINGS_FILE) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, DEBOUNCE_MS);
    });
  } catch (error) {
    console.error('[slick] could not watch settings; live reload is off:', error);
    return () => {};
  }

  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
