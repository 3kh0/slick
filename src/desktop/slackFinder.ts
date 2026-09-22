// Slick Desktop Slack Discovery
// Finds the installed Slack's resources directory (the one holding app.asar).
// Ported from the three v1 handoff builders, which each carried their own copy:
//   scripts/byoe/build-handoff-app.js       (macOS)
//   scripts/byoe/build-handoff-app-win.js   (Windows, standalone + MSIX)
//   scripts/byoe/build-handoff-linux.js     (Linux)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { settingsDir } from './paths.js';

const MAC_DEFAULT_APP = '/Applications/Slack.app';

const LINUX_CANDIDATES = [
  '/run/host/usr/lib/slack',
  '/run/host/opt/Slack',
  '/run/host/opt/slack',
  '/usr/lib/slack',
  '/opt/Slack',
  '/opt/slack',
];

/** Descending numeric compare of dotted version strings. */
function compareVersion(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

const hasAsar = (resources: string) => fs.existsSync(path.join(resources, 'app.asar'));

/** A user-pinned Slack location, written by the installer's --slack-app flag. */
function pinnedSlackApp(): string {
  try {
    return fs.readFileSync(path.join(settingsDir(), 'slack-app-path'), 'utf8').trim();
  } catch {
    return '';
  }
}

// macOS

function findMac(): string {
  const app = pinnedSlackApp() || MAC_DEFAULT_APP;
  const resources = path.join(app, 'Contents', 'Resources');
  return hasAsar(resources) ? resources : '';
}

/**
 * Slack's bundled Electron major, read from the framework plist. Slick's own
 * Electron major has to match it, so main.ts can refuse to boot on a mismatch.
 */
export function macSlackElectronMajor(resources: string): number {
  const plist = path.join(
    path.dirname(resources),
    'Frameworks',
    'Electron Framework.framework',
    'Resources',
    'Info.plist',
  );
  try {
    const raw = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', plist], {
      encoding: 'utf8',
    });
    return Number.parseInt(raw.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Slack's Electron major, or 0 when it cannot be read. macOS carries it in the
 * framework's Info.plist; on Windows and Linux electron-builder writes a
 * `version` file at the application root, one level above `resources`.
 */
export function slackElectronMajor(asar: string): number {
  const resources = path.dirname(asar);
  if (process.platform === 'darwin') return macSlackElectronMajor(resources);
  try {
    const raw = fs.readFileSync(path.join(path.dirname(resources), 'version'), 'utf8');
    return Number.parseInt(raw.trim().replace(/^v/, ''), 10) || 0;
  } catch {
    return 0;
  }
}

// Windows

/** COFF machine word -> arch, so an arm64 Slick does not adopt an x64 Slack. */
function peArch(file: string): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, 4, 0x3c);
    const machine = Buffer.alloc(2);
    fs.readSync(fd, machine, 0, 2, header.readUInt32LE(0) + 4);
    const value = machine.readUInt16LE(0);
    return value === 0x8664 ? 'x64' : value === 0xaa64 ? 'arm64' : '';
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function regQuery(args: string[]): string {
  try {
    return execFileSync('reg', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function findWindowsStandalone(): string[] {
  const base = path.join(process.env.LOCALAPPDATA || '', 'slack');
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(base).filter((name) => /^app-\d/.test(name));
  } catch {
    return [];
  }
  dirs.sort((a, b) => compareVersion(b.slice(4), a.slice(4)));
  return dirs.map((dir) => path.join(base, dir, 'resources')).filter(hasAsar);
}

// WindowsApps is ACL-locked, so the install location comes from the package
// repository registry key rather than a directory listing.
function findWindowsMsix(): string[] {
  const base = [
    'HKLM',
    'SOFTWARE',
    'Classes',
    'Local Settings',
    'Software',
    'Microsoft',
    'Windows',
    'CurrentVersion',
    'AppModel',
    'PackageRepository',
    'Packages',
  ].join('\\');

  const families = regQuery(['query', base])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /com\.tinyspeck\.slackdesktop_/.test(line))
    .map((line) => line.split('\\').pop() as string);

  families.sort((a, b) => compareVersion(b.split('_')[1] || '0', a.split('_')[1] || '0'));

  const found: string[] = [];
  for (const family of families) {
    const out = regQuery(['query', `${base}\\${family}`, '/v', 'Path']);
    const match = out.match(/Path\s+REG_SZ\s+(.+?)\s*$/m);
    if (!match) continue;
    const resources = path.join(match[1].trim(), 'app', 'resources');
    if (hasAsar(resources)) found.push(resources);
  }
  return found;
}

function findWindows(): string {
  const pinned = pinnedSlackApp();
  if (pinned && hasAsar(pinned)) return pinned;

  const candidates = [...findWindowsStandalone(), ...findWindowsMsix()];
  if (!candidates.length) return '';

  // Prefer a Slack whose architecture matches ours; Windows will not load a
  // mismatched native module into our process.
  const matched = candidates.find((resources) => {
    const exe = path.join(path.dirname(resources), 'slack.exe');
    return fs.existsSync(exe) && peArch(exe) === process.arch;
  });
  return matched || candidates[0];
}

// Linux

function findLinux(): string {
  const pinned = pinnedSlackApp();
  if (pinned && hasAsar(pinned)) return pinned;

  for (const dir of LINUX_CANDIDATES) {
    const resources = path.join(dir, 'resources');
    if (hasAsar(resources)) return resources;
  }
  return '';
}

/**
 * The installed Slack's `resources` directory, or '' when Slack is not found.
 * TAUT-style env override kept for development and the test harness.
 */
export function findSlackResources(): string {
  const override = process.env.SLICK_SLACK_RESOURCES;
  if (override) return hasAsar(override) ? override : '';

  if (process.platform === 'darwin') return findMac();
  if (process.platform === 'win32') return findWindows();
  return findLinux();
}

/** Slack's app.asar, or '' when Slack is not found. */
export function findSlackAsar(): string {
  const resources = findSlackResources();
  return resources ? path.join(resources, 'app.asar') : '';
}
