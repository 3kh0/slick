#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_SOURCE_DIST = process.env.SLICK_SOURCE_DIST || path.join(ROOT, 'byoe/node_modules/electron/dist');
const DEFAULTS = {
  target: path.join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'Slick'),
  profile: '',
  appVersion: '1.0.0',
  buildNumber: '0',
  sourceDist: DEFAULT_SOURCE_DIST,
  force: false,
};

function usage() {
  console.error(`Usage:
  node scripts/byoe/build-handoff-app-win.js [--target <dir>] [--profile <dir>] [--app-version <x.y.z>]
                                             [--build-number <n>] [--source-dist <electron/dist>] [--force]

Defaults:
  --target      ${DEFAULTS.target}
  --app-version ${DEFAULTS.appVersion}
  --build-number ${DEFAULTS.buildNumber}
  --source-dist ${DEFAULTS.sourceDist}`);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--target') o.target = argv[++i] || usage();
    else if (argv[i] === '--profile') o.profile = argv[++i] || usage();
    else if (argv[i] === '--app-version') o.appVersion = argv[++i] || usage();
    else if (argv[i] === '--build-number') o.buildNumber = argv[++i] || usage();
    else if (argv[i] === '--source-dist') o.sourceDist = argv[++i] || usage();
    else if (argv[i] === '--force') o.force = true;
    else usage();
  }
  return o;
}

function packAsar(files, outPath) {
  let offset = 0;
  const header = { files: {} };
  const blobs = files.map(({ name, contents }) => {
    const data = Buffer.from(contents);
    header.files[name] = { size: data.length, offset: String(offset) };
    offset += data.length;
    return data;
  });
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const padded = json.length + ((4 - (json.length % 4)) % 4);
  const head = Buffer.alloc(16 + padded);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(padded + 8, 4);
  head.writeUInt32LE(padded + 4, 8);
  head.writeUInt32LE(json.length, 12);
  json.copy(head, 16);
  fs.writeFileSync(outPath, Buffer.concat([head, ...blobs]));
}

function copyRuntime(resources) {
  const runtime = path.join(resources, 'slick');
  fs.rmSync(runtime, { recursive: true, force: true });
  for (const file of [
    'scripts/byoe/inject.js',
    'scripts/byoe/internals/index.js',
    'scripts/byoe/login-handoff.js',
    'scripts/byoe/perf.js',
    'scripts/byoe/plugins.js',
    'scripts/byoe/settings-renderer.js',
    'scripts/byoe/settings-ui.js',
    'scripts/byoe/switches.js',
    'scripts/byoe/updater.js',
    'scripts/theme.js',
  ]) {
    const target = path.join(runtime, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), target);
  }
  fs.cpSync(path.join(ROOT, 'plugins'), path.join(runtime, 'plugins'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'themes'), path.join(runtime, 'themes'), {
    recursive: true,
    filter: (source) => path.basename(source) !== '.active',
  });
}

function indexSource(opts, defaultTheme, profile) {
  return `'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog, shell } = require('electron');

const SLICK_ROOT = path.join(process.resourcesPath, 'slick');
const PROFILE = process.env.SLICK_HANDOFF_PROFILE || ${opts.profile ? JSON.stringify(profile) : "path.join(process.env.APPDATA || app.getPath('appData'), 'Slick')"};
const DEFAULT_THEME = ${JSON.stringify(defaultTheme)};
const SLICK_VERSION = ${JSON.stringify(opts.appVersion)};
const SLICK_BUILD = parseInt(${JSON.stringify(opts.buildNumber)}, 10) || 0;
const updater = require(path.join(SLICK_ROOT, 'scripts/byoe/updater.js')).create({ version: SLICK_VERSION, build: SLICK_BUILD, profile: PROFILE });
const RELEASES_URL = updater.RELEASES_URL;

function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

// Resolve the official Slack's resources dir at runtime. Two distributions:
//   - standalone Squirrel build -> %LOCALAPPDATA%\\slack\\app-<version>\\resources (x64)
//   - Microsoft Store MSIX build -> %ProgramFiles%\\WindowsApps\\com.tinyspeck...\\app\\resources
// Both bump versions on update, so never hard-code a path.
function findSlackStandalone() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'slack');
  let dirs = [];
  try {
    dirs = fs.readdirSync(base).filter((n) => /^app-\\d/.test(n));
  } catch {}
  dirs.sort((a, b) => cmpVersion(b.slice(4), a.slice(4)));
  for (const d of dirs) {
    const res = path.join(base, d, 'resources');
    if (fs.existsSync(path.join(res, 'app.asar'))) return res;
  }
  return '';
}

function regQuery(args) {
  try {
    return require('child_process').execFileSync('reg', args, { encoding: 'utf8', windowsHide: true });
  } catch {
    return '';
  }
}

// The WindowsApps dir is ACL-locked against enumeration, but the package's
// install path is published in this registry key (and updates with Slack).
function findSlackMsix() {
  const BS = String.fromCharCode(92);
  const base = ['HKLM', 'SOFTWARE', 'Classes', 'Local Settings', 'Software', 'Microsoft', 'Windows',
    'CurrentVersion', 'AppModel', 'PackageRepository', 'Packages'].join(BS);
  const families = regQuery(['query', base])
    .split(/\\r?\\n/)
    .map((s) => s.trim())
    .filter((l) => /com\\.tinyspeck\\.slackdesktop_/.test(l))
    .map((l) => l.split(BS).pop());
  families.sort((a, b) => cmpVersion((b.split('_')[1] || '0'), (a.split('_')[1] || '0')));
  for (const fam of families) {
    const out = regQuery(['query', base + BS + fam, '/v', 'Path']);
    const m = out.match(/Path\\s+REG_SZ\\s+(.+?)\\s*$/m);
    if (m) {
      const res = path.join(m[1].trim(), 'app', 'resources');
      if (fs.existsSync(path.join(res, 'app.asar'))) return res;
    }
  }
  return '';
}

function peArch(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const hdr = Buffer.alloc(4);
    fs.readSync(fd, hdr, 0, 4, 0x3c);
    const peoff = hdr.readUInt32LE(0);
    const mach = Buffer.alloc(2);
    fs.readSync(fd, mach, 0, 2, peoff + 4);
    fs.closeSync(fd);
    const m = mach.readUInt16LE(0);
    return m === 0x8664 ? 'x64' : m === 0xaa64 ? 'arm64' : '';
  } catch {
    return '';
  }
}

// Slick loads Slack's native (.node) modules, so when more than one Slack is
// installed prefer the one whose arch matches this Electron (process.arch).
function resourcesArch(res) {
  return peArch(path.join(res, '..', 'slack.exe'));
}

function findSlackResources() {
  const cands = [findSlackStandalone(), findSlackMsix()].filter(Boolean);
  const matched = cands.find((r) => resourcesArch(r) === process.arch);
  return matched || cands[0] || path.join(process.env.LOCALAPPDATA || '', 'slack', 'app-0.0.0', 'resources');
}

const SLACK_RESOURCES = process.env.SLICK_SLACK_RESOURCES || findSlackResources();
const SLACK_ASAR = path.join(SLACK_RESOURCES, 'app.asar');
const SLACK_UNPACKED = path.join(SLACK_RESOURCES, 'app.asar.unpacked');
const SLACK_APP_DIR = path.dirname(SLACK_RESOURCES);

// Slack's native (.node) modules depend on the VC++ runtime DLLs that ship next
// to Slack's binaries (one dir up from resources). Running Slack's code under
// Slick's own Electron, those aren't on the loader path — especially for the
// Store/MSIX build, whose DLLs live in the ACL-locked WindowsApps dir and whose
// arm64 VC++ runtime isn't installed system-wide. Prepend Slack's app dir so
// dlopen() can resolve them.
process.env.PATH = [SLACK_APP_DIR, process.env.PATH || ''].filter(Boolean).join(path.delimiter);

function slackElectronVersion() {
  try {
    return fs.readFileSync(path.join(SLACK_APP_DIR, 'version'), 'utf8').trim();
  } catch {
    return '';
  }
}

function nativeMirrorId() {
  const version = slackElectronVersion();
  if (version) return version;

  return (
    'unknown-' +
    crypto.createHash('sha256').update(SLACK_APP_DIR).digest('hex').slice(0, 12)
  );
}

// Windows permits reading another MSIX package's app.asar but rejects loading
// executable code from its WindowsApps directory with ERROR_ACCESS_DENIED.
function installNativeModuleMirror() {
  if (!fs.existsSync(SLACK_UNPACKED)) return;

  const mirror = path.join(PROFILE, 'slick', 'native', nativeMirrorId(), 'app.asar.unpacked');
  const ready = path.join(mirror, '.complete');
  if (!fs.existsSync(ready)) {
    const staging = mirror + '.tmp-' + process.pid;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(staging), { recursive: true });
    fs.cpSync(SLACK_UNPACKED, staging, { recursive: true });
    fs.writeFileSync(path.join(staging, '.complete'), '');
    fs.rmSync(mirror, { recursive: true, force: true });
    fs.renameSync(staging, mirror);
  }

  process.env.PATH = [SLACK_APP_DIR, mirror, process.env.PATH || ''].filter(Boolean).join(path.delimiter);

  const namespacedUnpacked = path.toNamespacedPath(path.resolve(SLACK_UNPACKED));
  const unpackedPrefix = namespacedUnpacked + path.sep;
  const dlopen = process.dlopen;
  process.dlopen = function slickDlopen(module, filename, flags) {
    const resolved = path.toNamespacedPath(path.resolve(filename));
    const mapped = resolved.toLowerCase().startsWith(unpackedPrefix.toLowerCase())
      ? path.join(mirror, path.relative(namespacedUnpacked, resolved))
      : filename;
    return dlopen.call(this, module, mapped, flags);
  };
}

function preflightProblem() {
  if (process.env.SLICK_SKIP_PREFLIGHT === '1') return null;
  if (!fs.existsSync(SLACK_ASAR)) return 'missing';
  const slackElectron = slackElectronVersion();
  if (slackElectron && slackElectron !== process.versions.electron) return 'mismatch:' + slackElectron;
  return null;
}

function handlePreflight(problem) {
  if (problem === 'missing') {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Slick',
      message: 'Slack is not installed',
      detail: 'Slick requires Slack desktop to be installed. Both the standalone download and Microsoft Store version are supported. Install Slack, then open Slick again.',
      buttons: ['Quit'],
    });
    return false;
  }
  const slackElectron = problem.slice('mismatch:'.length);
  const choice = dialog.showMessageBoxSync({
    type: 'error',
    title: 'Slick',
    message: 'This Slick build no longer matches Slack',
    detail:
      'Slack ships Electron ' +
      slackElectron +
      ', but this Slick build bundles Electron ' +
      process.versions.electron +
      '. Download the latest Slick release.',
    buttons: ['Open Releases Page', 'Launch Anyway', 'Quit'],
    defaultId: 0,
    cancelId: 2,
  });
  if (choice === 0) shell.openExternal(RELEASES_URL);
  if (choice === 1) {
    process.env.SLICK_SKIP_PREFLIGHT = '1';
    app.relaunch();
  }
  return false;
}

function seedSettings() {
  try {
    const dir = path.join(PROFILE, 'slick');
    fs.mkdirSync(dir, { recursive: true });
    const enabled = path.join(dir, 'enabled-plugins.json');
    if (!fs.existsSync(enabled)) fs.copyFileSync(path.join(SLICK_ROOT, 'plugins/enabled.json'), enabled);
    const activeTheme = path.join(dir, 'active-theme');
    if (DEFAULT_THEME && !fs.existsSync(activeTheme)) fs.writeFileSync(activeTheme, DEFAULT_THEME);
  } catch {}
}

function boot() {
  app.setPath('userData', PROFILE);
  app.setAppUserModelId('Slick');
  // Claim slack:// so browser login handoff opens Slick (writes HKCU on Windows).
  try {
    app.setAsDefaultProtocolClient('slack');
  } catch {}
  seedSettings();
  updater.scheduleUpdateChecks();

  try {
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: SLACK_RESOURCES });
  } catch {}

  const getAppPath = app.getAppPath.bind(app);
  app.getAppPath = () => (process.env.SLICK_HANDOFF_KEEP_WRAPPER_APP_PATH === '1' ? getAppPath() : SLACK_ASAR);
  installNativeModuleMirror();

  require(path.join(SLICK_ROOT, 'scripts/byoe/login-handoff.js'));
  require(path.join(SLICK_ROOT, 'scripts/byoe/inject.js'));
  require(SLACK_ASAR);
}

const problem = preflightProblem();
if (!problem) {
  boot();
} else {
  app.whenReady().then(() => {
    handlePreflight(problem);
    app.exit(problem === 'missing' ? 1 : 0);
  });
}
`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = path.resolve(opts.target);
  const sourceDist = path.resolve(opts.sourceDist);
  const profile = opts.profile ? path.resolve(opts.profile) : path.join(process.env.APPDATA || target, 'Slick');
  const activeThemeFile = path.join(ROOT, 'themes/.active');
  const defaultTheme = fs.existsSync(activeThemeFile) ? fs.readFileSync(activeThemeFile, 'utf8').trim() : '';

  if (!/^\d+\.\d+\.\d+$/.test(opts.appVersion)) throw new Error('--app-version must look like x.y.z');
  if (!/^(0|[1-9]\d*)$/.test(opts.buildNumber)) throw new Error('--build-number must be a non-negative integer');
  if (!fs.existsSync(path.join(sourceDist, 'electron.exe'))) {
    throw new Error(`BYOE Electron missing at ${sourceDist} (no electron.exe) — run \`bun install\` in byoe/ first`);
  }
  if (fs.existsSync(target)) {
    if (!opts.force) {
      throw new Error(`${target} already there; rerun with --force to replace it`);
    }
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (err) {
      if (err?.code !== 'EPERM') throw err;

      throw new Error(
        `Unable to replace ${target}. Slick appears to be running. Close all Slick windows and try again.`,
        { cause: err },
      );
    }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(sourceDist, target, { recursive: true });

  // Rename the launcher so the process/protocol registration reads as "Slick".
  const slickExe = path.join(target, 'Slick.exe');
  const electronExe = path.join(target, 'electron.exe');
  if (fs.existsSync(electronExe)) fs.renameSync(electronExe, slickExe);

  const res = path.join(target, 'resources');
  copyRuntime(res);

  const files = [
    {
      name: 'package.json',
      contents: `${JSON.stringify({ name: 'slick', productName: 'Slick', version: opts.appVersion, main: 'index.js' }, null, 2)}\n`,
    },
    { name: 'index.js', contents: indexSource(opts, defaultTheme, profile) },
  ];
  fs.rmSync(path.join(res, 'app'), { recursive: true, force: true });
  for (const name of ['default_app.asar', 'app.asar']) packAsar(files, path.join(res, name));

  console.log(
    JSON.stringify(
      { app: target, exe: slickExe, profile, note: 'Run Slick.exe to launch; it registers slack://' },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (e) {
  console.error(e?.stack || e);
  process.exit(1);
}
