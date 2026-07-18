#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const LINUX_SLACK_PATHS = [
  process.env.SLICK_SLACK_DIR,
  '/run/host/usr/lib/slack',
  '/run/host/opt/Slack',
  '/run/host/opt/slack',
  '/usr/lib/slack',
  '/opt/Slack',
  '/opt/slack',
  path.join(process.env.HOME || '', '.local/share/slack'),
].filter(Boolean);
const DEFAULTS = {
  target: path.join(ROOT, 'byoe', 'slick-linux'),
  sourceDist: '',
  appVersion: '1.0.0',
  buildNumber: '0',
  force: false,
};

function usage() {
  console.error(`Usage:
  node scripts/byoe/build-handoff-linux.js [--target <dir>] [--source-dist <electron/dist>]
                                           [--app-version <x.y.z>] [--build-number <n>] [--force]

Defaults:
  --target       ${DEFAULTS.target}
  --app-version  ${DEFAULTS.appVersion}
  --build-number ${DEFAULTS.buildNumber}`);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--target') o.target = argv[++i] || usage();
    else if (argv[i] === '--source-dist') o.sourceDist = argv[++i] || usage();
    else if (argv[i] === '--app-version') o.appVersion = argv[++i] || usage();
    else if (argv[i] === '--build-number') o.buildNumber = argv[++i] || usage();
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

function seedSettings(profile) {
  const settings = path.join(profile, 'slick');
  const enabled = path.join(settings, 'enabled-plugins.json');
  const activeTheme = path.join(settings, 'active-theme');
  fs.mkdirSync(settings, { recursive: true });
  if (!fs.existsSync(enabled)) fs.copyFileSync(path.join(ROOT, 'plugins/enabled.json'), enabled);
  if (!fs.existsSync(activeTheme) && fs.existsSync(path.join(ROOT, 'themes/.active'))) {
    fs.copyFileSync(path.join(ROOT, 'themes/.active'), activeTheme);
  }
}

function findSlack() {
  for (const dir of LINUX_SLACK_PATHS) {
    if (fs.existsSync(path.join(dir, 'resources', 'app.asar'))) return path.resolve(dir);
  }
  return '';
}

function parseVersion(value) {
  const match = String(value || '').match(/v?(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : '';
}

function getElectronVersion(slackDir) {
  const versionFile = path.join(slackDir, 'version');
  try {
    const version = parseVersion(fs.readFileSync(versionFile, 'utf8').trim());
    if (version) return version;
  } catch {}

  const bin = path.join(slackDir, 'slack');
  if (fs.existsSync(bin)) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
    return parseVersion(`${r.stdout || ''}\n${r.stderr || ''}`);
  }
  return '';
}

function electronVersion(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return '';
  return parseVersion(`${r.stdout || ''}\n${r.stderr || ''}`);
}

function findBestElectron(slackMajor) {
  for (const dir of [`/usr/lib/electron${slackMajor}`, '/usr/lib/electron']) {
    const bin = path.join(dir, 'electron');
    if (!fs.existsSync(bin)) continue;
    const version = electronVersion(bin);
    if (version.split('.')[0] === String(slackMajor)) return { bin, version, source: 'system' };
  }

  const npmBin = path.join(ROOT, 'byoe', 'node_modules', 'electron', 'dist', 'electron');
  if (fs.existsSync(npmBin)) {
    const versionFile = path.join(ROOT, 'byoe', 'node_modules', 'electron', 'dist', 'version');
    let version = '';
    try {
      version = parseVersion(fs.readFileSync(versionFile, 'utf8').trim());
    } catch {
      version = electronVersion(npmBin);
    }
    if (version.split('.')[0] === String(slackMajor)) return { bin: npmBin, version, source: 'npm' };
  }

  return null;
}

function wrapperSource(defaultTheme, opts) {
  return `'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, dialog, shell } = require('electron');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

const WRAPPER_RESOURCES = path.dirname(__dirname);
const SLICK_ROOT = path.join(WRAPPER_RESOURCES, 'slick');
const PROFILE = process.env.SLICK_HANDOFF_PROFILE || path.join(os.homedir(), '.config', 'slick');
const DEFAULT_THEME = ${JSON.stringify(defaultTheme)};
const SLICK_VERSION = ${JSON.stringify(opts.appVersion)};
const SLICK_BUILD = parseInt(${JSON.stringify(opts.buildNumber)}, 10) || 0;
const updater = require(path.join(SLICK_ROOT, 'scripts/byoe/updater.js')).create({ version: SLICK_VERSION, build: SLICK_BUILD, profile: PROFILE });
const RELEASES_URL = 'https://github.com/3kh0/slick/releases';

const LINUX_SLACK_PATHS = [
  process.env.SLICK_SLACK_DIR,
  '/run/host/usr/lib/slack',
  '/run/host/opt/Slack',
  '/run/host/opt/slack',
  '/usr/lib/slack',
  '/opt/Slack',
  '/opt/slack',
  path.join(os.homedir(), '.local/share/slack'),
].filter(Boolean);

function findSlackResources() {
  for (const dir of LINUX_SLACK_PATHS) {
    const res = path.join(dir, 'resources');
    if (fs.existsSync(path.join(res, 'app.asar'))) return res;
  }
  return path.join(LINUX_SLACK_PATHS[0] || '/usr/lib/slack', 'resources');
}

const SLACK_RESOURCES = process.env.SLICK_SLACK_RESOURCES || findSlackResources();
const SLACK_ASAR = path.join(SLACK_RESOURCES, 'app.asar');
const SLACK_APP_DIR = path.dirname(SLACK_RESOURCES);

function slackElectronVersion() {
  try {
    return fs.readFileSync(path.join(SLACK_APP_DIR, 'version'), 'utf8').trim();
  } catch {
    return '';
  }
}

function preflightProblem() {
  if (process.env.SLICK_SKIP_PREFLIGHT === '1') return null;
  if (!fs.existsSync(SLACK_ASAR)) return 'missing';
  const slackElectron = slackElectronVersion();
  if (slackElectron && slackElectron.split('.')[0] !== process.versions.electron.split('.')[0]) {
    return 'mismatch:' + slackElectron;
  }
  return null;
}

function handlePreflight(problem) {
  if (problem === 'missing') {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Slick',
      message: 'Slack is not installed',
      detail: 'Slick needs the official Slack Linux install. Install Slack, then open Slick again.',
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

function writeDesktopFile(target) {
  const desktop = `[Desktop Entry]
Type=Application
Name=Slick
Comment=Slack client mod (BYOE)
Exec=${path.join(target, 'electron')} %U
Icon=slick
Terminal=false
Categories=Network;InstantMessaging;
MimeType=x-scheme-handler/slack;
StartupWMClass=Slick
`;
  fs.writeFileSync(path.join(target, 'slick.desktop'), desktop);
}

function resolveElectron(opts) {
  if (opts.sourceDist) {
    const dist = path.resolve(opts.sourceDist);
    const bin = path.join(dist, 'electron');
    if (!fs.existsSync(bin)) throw new Error(`BYOE Electron missing at ${dist} (no electron binary)`);
    let version = '';
    try {
      version = parseVersion(fs.readFileSync(path.join(dist, 'version'), 'utf8').trim());
    } catch {
      version = electronVersion(bin);
    }
    return { bin, dist, version, source: 'source-dist' };
  }

  const slackDir = findSlack();
  if (!slackDir) throw new Error(`Slack not found. Probed: ${LINUX_SLACK_PATHS.join(', ')}`);
  const slackElectron = getElectronVersion(slackDir);
  if (!slackElectron) throw new Error(`Could not read Slack's Electron version from ${slackDir}`);
  const slackMajor = parseInt(slackElectron, 10);
  const electron = findBestElectron(slackMajor);
  if (!electron) {
    throw new Error(`No Electron ${slackMajor}.x found. Run ./install-linux.sh to install a matching BYOE Electron.`);
  }
  return { ...electron, dist: path.dirname(electron.bin) };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!/^\d+\.\d+\.\d+$/.test(opts.appVersion)) throw new Error('--app-version must look like x.y.z');
  if (!/^(0|[1-9]\d*)$/.test(opts.buildNumber)) throw new Error('--build-number must be a non-negative integer');
  const target = path.resolve(opts.target);
  const electron = resolveElectron(opts);

  if (fs.existsSync(target)) {
    if (!opts.force) throw new Error(`${target} already exists; rerun with --force to replace it`);
    fs.rmSync(target, { recursive: true, force: true });
  }

  const resources = path.join(target, 'resources');
  const profile = path.join(process.env.HOME || '', '.config', 'slick');
  const activeThemeFile = path.join(ROOT, 'themes/.active');
  const defaultTheme = fs.existsSync(activeThemeFile) ? fs.readFileSync(activeThemeFile, 'utf8').trim() : '';
  fs.cpSync(electron.dist, target, { recursive: true });

  copyRuntime(resources);
  seedSettings(profile);
  const files = [
    {
      name: 'package.json',
      contents: `${JSON.stringify({ name: 'slick', productName: 'Slick', version: opts.appVersion, main: 'index.js' }, null, 2)}\n`,
    },
    { name: 'index.js', contents: wrapperSource(defaultTheme, opts) },
  ];
  fs.rmSync(path.join(resources, 'app'), { recursive: true, force: true });
  for (const name of ['default_app.asar', 'app.asar']) packAsar(files, path.join(resources, name));
  writeDesktopFile(target);

  console.log(
    JSON.stringify(
      {
        app: target,
        electron: electron.bin,
        electronVersion: electron.version,
        electronSource: electron.source,
        profile,
      },
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
