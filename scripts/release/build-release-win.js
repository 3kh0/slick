#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const BUILD = path.join(ROOT, 'build');
const CACHE = path.join(BUILD, 'cache');
const DIST = path.join(ROOT, 'dist');
const ELECTRON_VERSION = require(path.join(ROOT, 'byoe/package.json')).dependencies.electron.replace(/[^\d.]/g, '');
const RCEDIT_VERSION = 'v2.0.0';
const DEFAULTS = { buildNumber: '0', arch: ['x64'] };

function latest() {
  const r = spawnSync('git', ['tag', '--list', 'v[0-9]*', '--sort=-v:refname'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) return DEFAULTS.buildNumber;
  const tag = r.stdout.split(/\r?\n/).find((t) => /^v[1-9]\d*$/.test(t));
  return tag ? tag.slice(1) : DEFAULTS.buildNumber;
}

function usage() {
  console.error(`Usage:
  node scripts/release/build-release-win.js [--build-number <n>] [--app-version <x.y.z>] [--arch x64,arm64]

Defaults:
  --build-number ${latest()}
  --app-version  1.0.<build-number>
  --arch         ${DEFAULTS.arch.join(',')}`);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { ...DEFAULTS, buildNumber: process.env.SLICK_BUILD_NUMBER || latest(), appVersion: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--build-number') o.buildNumber = argv[++i] || usage();
    else if (argv[i] === '--app-version') o.appVersion = argv[++i] || usage();
    else if (argv[i] === '--arch') o.arch = (argv[++i] || usage()).split(',');
    else usage();
  }
  if (!/^(0|[1-9]\d*)$/.test(o.buildNumber)) usage();
  o.appVersion ||= `1.0.${o.buildNumber}`;
  if (!/^\d+\.\d+\.\d+$/.test(o.appVersion)) usage();
  for (const a of o.arch) if (!['x64', 'arm64'].includes(a)) usage();
  return o;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed (exit ${r.status})`);
}

function ps(command) {
  run('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]);
}

function q(p) {
  return `'${p.replace(/'/g, "''")}'`;
}

function step(msg) {
  console.log(`\x1b[1;35m==>\x1b[0m \x1b[1m${msg}\x1b[0m`);
}

function fetchTo(url, dest) {
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  run('curl', ['--fail', '--location', '--progress-bar', '-o', `${dest}.part`, url]);
  fs.renameSync(`${dest}.part`, dest);
}

function fetchElectron(arch) {
  const zip = path.join(CACHE, `electron-v${ELECTRON_VERSION}-win32-${arch}.zip`);
  if (!fs.existsSync(zip)) {
    step(`Downloading Electron ${ELECTRON_VERSION} (win32-${arch})`);
    fetchTo(`https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${path.basename(zip)}`, zip);
  }
  const dist = path.join(BUILD, arch, 'electron');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  ps(`Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(dist)} -Force`);
  if (!fs.existsSync(path.join(dist, 'electron.exe'))) throw new Error('electron extraction failed (no electron.exe)');
  return dist;
}

function brand(exe, opts) {
  const rcedit = path.join(CACHE, 'rcedit-x64.exe');
  fetchTo(`https://github.com/electron/rcedit/releases/download/${RCEDIT_VERSION}/rcedit-x64.exe`, rcedit);
  const icon = path.join(ROOT, 'assets', 'icon.ico');
  if (!fs.existsSync(icon)) {
    console.warn('    warning: assets/icon.ico missing - keeping the default Electron icon.');
    return;
  }
  step('Branding Slick.exe (icon + version info)');
  run(rcedit, [
    exe,
    '--set-icon',
    icon,
    '--set-version-string',
    'FileDescription',
    'Slick',
    '--set-version-string',
    'ProductName',
    'Slick',
    '--set-version-string',
    'InternalName',
    'Slick',
    '--set-version-string',
    'OriginalFilename',
    'Slick.exe',
    '--set-version-string',
    'CompanyName',
    'Slick',
    '--set-version-string',
    'LegalCopyright',
    'Slick (Slack client mod) by @3kh0',
    '--set-file-version',
    `${opts.appVersion}.0`,
    '--set-product-version',
    opts.appVersion,
  ]);
}

function buildArch(arch, opts) {
  const electron = fetchElectron(arch);
  const app = path.join(BUILD, arch, 'Slick');

  step(`Building Slick Build ${opts.buildNumber} (${opts.appVersion}, win32-${arch})`);
  run('node', [
    path.join(ROOT, 'scripts/byoe/build-handoff-app-win.js'),
    '--source-dist',
    electron,
    '--target',
    app,
    '--app-version',
    opts.appVersion,
    '--build-number',
    opts.buildNumber,
    '--force',
  ]);

  brand(path.join(app, 'Slick.exe'), opts);

  step(`Packaging zip (win32-${arch})`);
  fs.mkdirSync(DIST, { recursive: true });
  const zip = path.join(DIST, `Slick-build-${opts.buildNumber}-win32-${arch}.zip`);
  fs.rmSync(zip, { force: true });
  ps(`Compress-Archive -Path ${q(app)} -DestinationPath ${q(zip)} -Force`);
}

function main() {
  if (process.platform !== 'win32') throw new Error('this is for windows lol');
  const opts = parseArgs(process.argv.slice(2));
  for (const arch of opts.arch) buildArch(arch, opts);
  step('Done');
  for (const f of fs.readdirSync(DIST).toSorted()) {
    const size = fs.statSync(path.join(DIST, f)).size;
    console.log(`    dist/${f} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  }
}

try {
  main();
} catch (e) {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
}
