import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { settingsDir } from './paths.ts';

export const ICON_REV = 'molten-hash-1';

const REV_FILE = 'icon-rev';
const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 15_000 }, () => resolve()));
}

export function syncLinuxIcons(bundledDir: string, hicolorDir: string): number {
  let replaced = 0;
  let entries: string[];
  try {
    entries = fs.readdirSync(bundledDir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    const size = /^(\d+)\.png$/.exec(name)?.[1];
    if (!size) continue;
    const installed = path.join(hicolorDir, `${size}x${size}`, 'apps', 'slick.png');
    if (!fs.existsSync(installed)) continue;
    fs.copyFileSync(path.join(bundledDir, name), installed);
    replaced += 1;
  }
  if (replaced) {
    // Bumps the theme dir mtime, which is what icon caches compare.
    const now = new Date();
    fs.utimesSync(hicolorDir, now, now);
  }
  return replaced;
}

async function refresh(resourcesPath: string): Promise<void> {
  if (process.platform === 'darwin') {
    const bundle = path.resolve(process.execPath, '..', '..', '..');
    if (!bundle.endsWith('.app')) return;
    const now = new Date();
    fs.utimesSync(bundle, now, now);
    await run(LSREGISTER, ['-f', bundle]);
  } else if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    await run(path.join(root, 'System32', 'ie4uinit.exe'), ['-show']);
  } else {
    const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    const hicolor = path.join(dataHome, 'icons', 'hicolor');
    if (syncLinuxIcons(path.join(resourcesPath, 'icons'), hicolor)) {
      await run('gtk-update-icon-cache', ['-f', '-t', hicolor]);
    }
  }
}

export async function refreshInstalledIcons(resourcesPath: string, packaged: boolean): Promise<void> {
  if (!packaged) return;
  const revFile = path.join(settingsDir(), REV_FILE);
  try {
    if (fs.readFileSync(revFile, 'utf8').trim() === ICON_REV) return;
  } catch {
    // First launch, or first since this was added.
  }
  try {
    await refresh(resourcesPath);
  } catch (error) {
    console.error('[slick] could not refresh installed icons:', error);
  }
  // Written even after a failure: a cache poke is not worth retrying every launch.
  try {
    fs.mkdirSync(path.dirname(revFile), { recursive: true });
    fs.writeFileSync(revFile, `${ICON_REV}\n`);
  } catch {
    // Unwritable config dir; retried next launch.
  }
}
