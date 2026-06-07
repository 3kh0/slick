#!/usr/bin/env node
// Build distributable Slick.app artifacts (zip + dmg per arch) into dist/.
// Downloads stock Electron for each arch, so this works on a clean machine/CI runner
// without Slack installed (the app checks for Slack at launch instead).
//   node scripts/release/build-release.js [--version <x.y.z>] [--arch arm64,x64]
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const BUILD = path.join(ROOT, 'build');
const CACHE = path.join(BUILD, 'cache');
const DIST = path.join(ROOT, 'dist');
const ELECTRON_VERSION = require(path.join(ROOT, 'byoe/package.json')).dependencies.electron;
const DEFAULTS = { version: '0.0.1', arch: ['arm64', 'x64'] };
const SIGN_IDENTITY = process.env.SLICK_SIGN_IDENTITY || '';
const NOTARY = ['APPLE_ID', 'APPLE_TEAM_ID', 'APPLE_APP_PASSWORD'].every((k) => process.env[k]);

function usage() {
  console.error(`Usage:
  node scripts/release/build-release.js [--version <x.y.z>] [--arch arm64,x64]

Defaults:
  --version ${DEFAULTS.version}
  --arch    ${DEFAULTS.arch.join(',')}`);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--version') o.version = argv[++i] || usage();
    else if (argv[i] === '--arch') o.arch = (argv[++i] || usage()).split(',');
    else usage();
  }
  for (const a of o.arch) if (!['arm64', 'x64'].includes(a)) usage();
  return o;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed (exit ${r.status})`);
}

function step(msg) {
  console.log(`\x1b[1;35m==>\x1b[0m \x1b[1m${msg}\x1b[0m`);
}

function fetchElectron(arch) {
  const zip = path.join(CACHE, `electron-v${ELECTRON_VERSION}-darwin-${arch}.zip`);
  if (!fs.existsSync(zip)) {
    step(`Downloading Electron ${ELECTRON_VERSION} (${arch})`);
    const url = `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${path.basename(zip)}`;
    fs.mkdirSync(CACHE, { recursive: true });
    run('curl', ['--fail', '--location', '--progress-bar', '-o', `${zip}.part`, url]);
    fs.renameSync(`${zip}.part`, zip);
  }
  const dist = path.join(BUILD, arch, 'electron');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  run('/usr/bin/ditto', ['-x', '-k', zip, dist]);
  return path.join(dist, 'Electron.app');
}

function signAndNotarize(app, arch) {
  if (!SIGN_IDENTITY) {
    step('SLICK_SIGN_IDENTITY not set, skipping notarization');
    return;
  }
  step(`Signing ${arch}`);
  run('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--options',
    'runtime',
    '--timestamp',
    '--entitlements',
    path.join(__dirname, 'entitlements.plist'),
    '--sign',
    SIGN_IDENTITY,
    app,
  ]);
  if (!NOTARY) {
    step('APPLE_ID/APPLE_TEAM_ID/APPLE_APP_PASSWORD not set, skipping notarization');
    return;
  }
  step(`Notarizing ${arch}`);
  const zip = `${app}.notarize.zip`;
  fs.rmSync(zip, { force: true });
  run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip]);
  run('xcrun', [
    'notarytool',
    'submit',
    zip,
    '--wait',
    '--apple-id',
    process.env.APPLE_ID,
    '--team-id',
    process.env.APPLE_TEAM_ID,
    '--password',
    process.env.APPLE_APP_PASSWORD,
  ]);
  fs.rmSync(zip, { force: true });
  run('xcrun', ['stapler', 'staple', app]);
}

function buildArch(arch, version) {
  const sourceApp = fetchElectron(arch);
  const app = path.join(BUILD, arch, 'Slick.app');

  step(`Building Slick.app ${version} (${arch})`);
  run('node', [
    path.join(ROOT, 'scripts/byoe/build-handoff-app.js'),
    '--source-app',
    sourceApp,
    '--target',
    app,
    '--app-version',
    version,
    '--allow-non-tmp',
    '--force',
  ]);
  run(path.join(ROOT, 'scripts/byoe/set-icon.sh'), [app, '--no-register']);
  signAndNotarize(app, arch);

  step(`Packaging zip + dmg (${arch})`);
  fs.mkdirSync(DIST, { recursive: true });
  const zip = path.join(DIST, `Slick-${version}-${arch}.zip`);
  fs.rmSync(zip, { force: true });
  run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip]);

  const staging = path.join(BUILD, arch, 'dmg');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  run('/usr/bin/ditto', [app, path.join(staging, 'Slick.app')]);
  fs.symlinkSync('/Applications', path.join(staging, 'Applications'));
  const dmg = path.join(DIST, `Slick-${version}-${arch}.dmg`);
  fs.rmSync(dmg, { force: true });
  run('/usr/bin/hdiutil', ['create', '-volname', 'Slick', '-srcfolder', staging, '-format', 'UDZO', dmg]);
}

function main() {
  if (process.platform !== 'darwin') throw new Error('release builds need macOS');
  const opts = parseArgs(process.argv.slice(2));
  for (const arch of opts.arch) buildArch(arch, opts.version);
  step('Done');
  for (const f of fs.readdirSync(DIST).toSorted()) {
    const size = fs.statSync(path.join(DIST, f)).size;
    console.log(`    dist/${f} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  }
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
