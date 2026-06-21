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

function indexSource(opts, defaultTheme) {
  return `'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const { app, dialog, shell } = require('electron');

const SLICK_ROOT = path.join(process.resourcesPath, 'slick');
const PROFILE = process.env.SLICK_HANDOFF_PROFILE || path.join(app.getPath('appData'), 'Slick');
const DEFAULT_THEME = ${JSON.stringify(defaultTheme)};
const SLICK_VERSION = ${JSON.stringify(opts.appVersion)};
const SLICK_BUILD = parseInt(${JSON.stringify(opts.buildNumber)}, 10) || 0;
const RELEASES_URL = 'https://github.com/3kh0/slick/releases';
const LATEST_RELEASE_API = 'https://api.github.com/repos/3kh0/slick/releases/latest';
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const STARTUP_UPDATE_DELAY = 30 * 1000;

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
//   - Microsoft Store MSIX build -> %ProgramFiles%\\WindowsApps\\com.tinyspeck...\\app\\resources (arm64)
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

// Slack's native (.node) modules depend on the VC++ runtime DLLs that ship next
// to Slack's binaries (one dir up from resources). Running Slack's code under
// Slick's own Electron, those aren't on the loader path — especially for the
// Store/MSIX build, whose DLLs live in the ACL-locked WindowsApps dir and whose
// arm64 VC++ runtime isn't installed system-wide. Prepend Slack's app dir so
// dlopen() can resolve them.
try {
  process.env.PATH = path.dirname(SLACK_RESOURCES) + path.delimiter + (process.env.PATH || '');
} catch {}

function preflight() {
  if (!fs.existsSync(SLACK_ASAR)) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Slick',
      message: 'Slack is not installed',
      detail: 'Slick needs the official Slack desktop app (the standalone download from slack.com, installed under %LOCALAPPDATA%\\\\slack). Install it, then open Slick again.',
      buttons: ['Quit'],
    });
    return false;
  }
  // NOTE: Windows has no easy on-disk Electron-version marker for Slack, so the
  // build-time electron pin is trusted instead of a runtime mismatch dialog.
  return true;
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

function updateStatePath() {
  return path.join(PROFILE, 'slick', 'update-check.json');
}

function readUpdateState() {
  try {
    return JSON.parse(fs.readFileSync(updateStatePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeUpdateState(state) {
  try {
    const file = updateStatePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\\n');
  } catch {}
}

function releaseBuild(release) {
  const match = /^v([1-9]\\d*)$/.exec(String((release && release.tag_name) || '').trim());
  return match ? parseInt(match[1], 10) : 0;
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      LATEST_RELEASE_API,
      { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Slick/' + SLICK_VERSION + ' Build ' + SLICK_BUILD } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error('update check returned HTTP ' + res.statusCode));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 1024 * 1024) req.destroy(new Error('update response was too large'));
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.setTimeout(15000, () => req.destroy(new Error('update check timed out')));
    req.on('error', reject);
  });
}

async function checkForUpdates() {
  if (!SLICK_BUILD) return;
  const now = Date.now();
  const state = readUpdateState();
  if (state.lastCheckedAt && now - state.lastCheckedAt < UPDATE_CHECK_INTERVAL) return;
  writeUpdateState({ ...state, lastCheckedAt: now });

  let release;
  try {
    release = await fetchLatestRelease();
  } catch {
    return;
  }

  const latestBuild = releaseBuild(release);
  if (latestBuild <= SLICK_BUILD) return;

  const promptState = readUpdateState();
  if (promptState.lastPromptedBuild === latestBuild && now - (promptState.lastPromptedAt || 0) < UPDATE_CHECK_INTERVAL) {
    return;
  }
  writeUpdateState({ ...promptState, lastPromptedBuild: latestBuild, lastPromptedAt: Date.now() });

  dialog
    .showMessageBox({
      type: 'info',
      title: 'Slick update available',
      message: 'Slick Build ' + latestBuild + ' is available',
      detail: 'You are running Build ' + SLICK_BUILD + '. Open the release page to download it, or rerun the installer when you are ready.',
      buttons: ['Open Release Page', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    .then(({ response }) => {
      if (response === 0) return shell.openExternal(release.html_url || RELEASES_URL);
      return undefined;
    })
    .catch(() => {});
}

function scheduleUpdateChecks() {
  if (!SLICK_BUILD) return;
  const run = () => {
    checkForUpdates();
    setTimeout(run, UPDATE_CHECK_INTERVAL);
  };
  app
    .whenReady()
    .then(() => {
      const state = readUpdateState();
      const elapsed = Date.now() - (state.lastCheckedAt || 0);
      const delay = state.lastCheckedAt ? Math.max(STARTUP_UPDATE_DELAY, UPDATE_CHECK_INTERVAL - elapsed) : STARTUP_UPDATE_DELAY;
      setTimeout(run, delay);
    })
    .catch(() => {});
}

if (!preflight()) {
  app.exit(1);
} else {
  app.setPath('userData', PROFILE);
  // Claim slack:// so browser login handoff opens Slick (writes HKCU on Windows).
  try {
    app.setAsDefaultProtocolClient('slack');
  } catch {}
  seedSettings();
  scheduleUpdateChecks();

  try {
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: SLACK_RESOURCES });
  } catch {}

  const getAppPath = app.getAppPath.bind(app);
  app.getAppPath = () => (process.env.SLICK_HANDOFF_KEEP_WRAPPER_APP_PATH === '1' ? getAppPath() : SLACK_ASAR);

  require(path.join(SLICK_ROOT, 'scripts/byoe/login-handoff.js'));
  require(path.join(SLICK_ROOT, 'scripts/byoe/inject.js'));
  require(SLACK_ASAR);
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
    if (!opts.force) throw new Error(`${target} already there; rerun with --force to replace it`);
    fs.rmSync(target, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(sourceDist, target, { recursive: true });

  // Rename the launcher so the process/protocol registration reads as "Slick".
  const slickExe = path.join(target, 'Slick.exe');
  const electronExe = path.join(target, 'electron.exe');
  if (fs.existsSync(electronExe)) fs.renameSync(electronExe, slickExe);

  const res = path.join(target, 'resources');
  copyRuntime(res);
  seedSettings(profile);

  const files = [
    {
      name: 'package.json',
      contents: `${JSON.stringify({ name: 'slick', productName: 'Slick', version: opts.appVersion, main: 'index.js' }, null, 2)}\n`,
    },
    { name: 'index.js', contents: indexSource(opts, defaultTheme) },
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
