// Finds the installed Slack's resources directory (the one holding app.asar).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { settingsDir } from './paths.js';
import { downloadedSlackResources } from './linuxArm64Slack.js';

const MAC_DEFAULT_APP = '/Applications/Slack.app';

const LINUX_CANDIDATES = [
  '/run/host/usr/lib/slack',
  '/run/host/opt/Slack',
  '/run/host/opt/slack',
  '/usr/lib/slack',
  '/opt/Slack',
  '/opt/slack',
  // Nix profiles expose Slack's lib/slack/resources/app.asar symlink.
  '/run/current-system/sw/lib/slack',
  path.join(process.env.HOME || '', '.nix-profile/lib/slack'),
  path.join('/etc/profiles/per-user', process.env.USER || '', 'lib/slack'),
  // Last, so a native package wins over the snap.
  '/snap/slack/current/usr/lib/slack',
];

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

/** The Slack.app Slick runs on: the installer's pin, else /Applications. */
export function macSlackApp(): string {
  return pinnedSlackApp() || MAC_DEFAULT_APP;
}

function findMac(): string {
  const resources = path.join(macSlackApp(), 'Contents', 'Resources');
  return hasAsar(resources) ? resources : '';
}

function macSlackElectronVersion(resources: string): string {
  const plist = path.join(
    path.dirname(resources),
    'Frameworks',
    'Electron Framework.framework',
    'Resources',
    'Info.plist',
  );
  try {
    return execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', plist], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Slack's Electron version, or ''. macOS: the framework's Info.plist; elsewhere
 * electron-builder's `version` file one level above `resources`.
 */
function electronVersionAt(resources: string): string {
  if (process.platform === 'darwin') return macSlackElectronVersion(resources);
  try {
    return fs
      .readFileSync(path.join(path.dirname(resources), 'version'), 'utf8')
      .trim()
      .replace(/^v/, '');
  } catch {
    return '';
  }
}

export const slackElectronVersion = (asar: string) => electronVersionAt(path.dirname(asar));

export function slackVersion(asar: string): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(asar, 'package.json'), 'utf8')).version || '';
  } catch {
    return /(?:app-|Slack_)(\d+\.\d+\.\d+)/.exec(asar)?.[1] || '';
  }
}

export type SlackInstallKind = 'override' | 'pinned' | 'store' | 'standalone' | 'snap' | '';

export function slackInstallKind(asar: string): SlackInstallKind {
  if (process.env.SLICK_SLACK_RESOURCES) return 'override';
  const pinned = pinnedSlackApp();
  if (pinned && asar.startsWith(pinned)) return 'pinned';
  if (/[\\/]WindowsApps[\\/]/i.test(asar)) return 'store';
  if (asar.startsWith('/snap/')) return 'snap';
  if (process.platform === 'win32' && /[\\/]slack[\\/]app-\d/i.test(asar)) return 'standalone';
  return '';
}

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
    return execFileSync('reg', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
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

// WindowsApps is ACL-locked, so read the install location from the registry.
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

  return pickSlackResources(candidates, {
    arch: (resources) => peArch(path.join(path.dirname(resources), 'slack.exe')),
    electronMajor: (resources) => Number.parseInt(electronVersionAt(resources), 10) || 0,
  });
}

/**
 * Windows won't load a native module of another arch into our process, and
 * Slack's natives only load under a matching Electron major, so with several
 * installs (an old Squirrel dir beside a Store copy) take the one that runs.
 */
export function pickSlackResources(
  candidates: string[],
  probe: {
    arch: (resources: string) => string;
    electronMajor: (resources: string) => number;
  },
  ours = {
    arch: process.arch as string,
    electronMajor: Number.parseInt(process.versions.electron, 10) || 0,
  },
): string {
  const sameArch = candidates.filter((resources) => probe.arch(resources) === ours.arch);
  const pool = sameArch.length ? sameArch : candidates;
  return pool.find((resources) => probe.electronMajor(resources) === ours.electronMajor) || pool[0] || '';
}

function findLinux(): string {
  const pinned = pinnedSlackApp();
  if (pinned && hasAsar(pinned)) return pinned;

  for (const dir of LINUX_CANDIDATES) {
    const resources = path.join(dir, 'resources');
    if (hasAsar(resources)) return resources;
  }
  if (process.arch === 'arm64') {
    const cached = downloadedSlackResources();
    if (hasAsar(cached)) return cached;
  }
  return '';
}

/** '' when Slack is not found. SLICK_SLACK_RESOURCES overrides, for dev and tests. */
export function findSlackResources(): string {
  const override = process.env.SLICK_SLACK_RESOURCES;
  if (override) return hasAsar(override) ? override : '';

  if (process.platform === 'darwin') return findMac();
  if (process.platform === 'win32') return findWindows();
  return findLinux();
}

export function findSlackAsar(): string {
  const resources = findSlackResources();
  return resources ? path.join(resources, 'app.asar') : '';
}
