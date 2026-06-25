#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_SOURCE_APP = path.join(ROOT, 'byoe/node_modules/electron/dist/Electron.app');
const SLACK_RESOURCES = '/Applications/Slack.app/Contents/Resources';
const SLACK_ASAR = path.join(SLACK_RESOURCES, 'app.asar');
const ENTITLEMENTS = path.join(ROOT, 'scripts/release/entitlements.plist');
const DEFAULTS = {
  target: '/tmp/slick/Slick.app',
  profile: '/tmp/slick/profile',
  appVersion: '1.0.0',
  buildNumber: '0',
  sourceApp: process.env.SLICK_SOURCE_APP || DEFAULT_SOURCE_APP,
  force: false,
  allowNonTmp: false,
};

function usage() {
  console.error(`Usage:
  node scripts/byoe/build-handoff-app.js [--target <app>] [--profile <dir>] [--app-version <x.y.z>]
                                         [--build-number <n>]
                                         [--source-app <Electron.app>] [--force] [--allow-non-tmp]

Defaults:
  --target      ${DEFAULTS.target}
  --profile     ${DEFAULTS.profile}
  --app-version ${DEFAULTS.appVersion}
  --build-number ${DEFAULTS.buildNumber}
  --source-app  ${DEFAULTS.sourceApp}`);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--target') o.target = argv[++i] || usage();
    else if (argv[i] === '--profile') o.profile = argv[++i] || usage();
    else if (argv[i] === '--app-version') o.appVersion = argv[++i] || usage();
    else if (argv[i] === '--build-number') o.buildNumber = argv[++i] || usage();
    else if (argv[i] === '--source-app') o.sourceApp = argv[++i] || usage();
    else if (argv[i] === '--force') o.force = true;
    else if (argv[i] === '--allow-non-tmp') o.allowNonTmp = true;
    else usage();
  }
  return o;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || `${cmd} failed`).trim());
}
const plutil = (...args) => run('/usr/bin/plutil', args);

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

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = path.resolve(opts.target);
  const profile = path.resolve(opts.profile);
  const sourceApp = path.resolve(opts.sourceApp);
  const activeThemeFile = path.join(ROOT, 'themes/.active');
  const defaultTheme = fs.existsSync(activeThemeFile) ? fs.readFileSync(activeThemeFile, 'utf8').trim() : '';

  if (!/^\d+\.\d+\.\d+$/.test(opts.appVersion)) throw new Error('--app-version must look like x.y.z');
  if (!/^(0|[1-9]\d*)$/.test(opts.buildNumber)) throw new Error('--build-number must be a non-negative integer');
  if (!fs.existsSync(sourceApp)) throw new Error(`BYOE Electron missing at ${sourceApp}`);
  if (!opts.allowNonTmp && !target.startsWith('/tmp/') && !target.startsWith('/private/tmp/')) {
    throw new Error('prototype tg must be at under /tmp unless --allow-non-tmp is here, and its fucking not');
  }
  if (fs.existsSync(target)) {
    if (!opts.force) throw new Error(`${target} already there; rerun with --force if you wanna kill it`);
    fs.rmSync(target, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(sourceApp, target, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });

  const res = path.join(target, 'Contents/Resources');
  const plist = path.join(target, 'Contents/Info.plist');
  for (const [k, v] of Object.entries({
    CFBundleIdentifier: 'dev.slick.byoe.handoff',
    CFBundleName: 'Slick',
    CFBundleDisplayName: 'Slick',
    CFBundleExecutable: 'Electron',
    CFBundleShortVersionString: opts.appVersion,
    CFBundleVersion: opts.buildNumber,
  }))
    plutil('-replace', k, '-string', v, plist);
  for (const k of ['ElectronAsarIntegrity', 'CFBundleURLTypes'])
    spawnSync('/usr/bin/plutil', ['-remove', k, plist], { encoding: 'utf8' });
  plutil(
    '-insert',
    'CFBundleURLTypes',
    '-json',
    JSON.stringify([{ CFBundleURLName: 'Slack URL', CFBundleURLSchemes: ['slack'] }]),
    plist,
  );
  copyRuntime(res);
  seedSettings(profile);

  const files = [
    {
      name: 'package.json',
      contents: `${JSON.stringify({ name: 'slick', productName: 'Slick', version: opts.appVersion, main: 'index.js' }, null, 2)}\n`,
    },
    {
      name: 'index.js',
      contents: `'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const { app, dialog, shell, Menu, MenuItem, BrowserWindow } = require('electron');

const SLICK_ROOT = path.join(process.resourcesPath, 'slick');
const PROFILE = process.env.SLICK_HANDOFF_PROFILE || path.join(app.getPath('appData'), 'Slick');
const DEFAULT_THEME = ${JSON.stringify(defaultTheme)};
const SLACK_RESOURCES = ${JSON.stringify(SLACK_RESOURCES)};
const SLACK_ASAR = ${JSON.stringify(SLACK_ASAR)};
const SLICK_VERSION = ${JSON.stringify(opts.appVersion)};
const SLICK_BUILD = parseInt(${JSON.stringify(opts.buildNumber)}, 10) || 0;
const RELEASES_URL = 'https://github.com/3kh0/slick/releases';
const LATEST_RELEASE_API = 'https://api.github.com/repos/3kh0/slick/releases/latest';
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const STARTUP_UPDATE_DELAY = 30 * 1000;

function slackElectronMajor() {
  try {
    const plist = '/Applications/Slack.app/Contents/Frameworks/Electron Framework.framework/Resources/Info.plist';
    const raw = require('child_process').execFileSync(
      '/usr/bin/plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', plist], { encoding: 'utf8' },
    );
    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}

function preflight() {
  if (!fs.existsSync(SLACK_ASAR)) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Slick',
      message: 'Slack is not installed',
      detail: 'Slick needs the official Slack app at /Applications/Slack.app. Install it from slack.com, then open Slick again.',
      buttons: ['Quit'],
    });
    return false;
  }
  const x = slackElectronMajor();
  const y = parseInt(process.versions.electron, 10);
  if (x && x !== y) {
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Slick',
      message: 'This Slick build no longer matches Slack',
      detail: 'Slack now ships Electron ' + x + ', but this Slick build bundles Electron ' + y + '. Download the latest Slick release.',
      buttons: ['Open Releases Page', 'Launch Anyway', 'Quit'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice === 0) shell.openExternal(RELEASES_URL);
    return choice === 1;
  }
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

function UpdateTime(value) {
  const date = new Date(value || 0);
  if (!value || Number.isNaN(date.getTime())) return 'Never';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function showAbout() {
  const lastChecked = UpdateTime(readUpdateState().lastCheckedAt);
  const build = SLICK_BUILD ? 'Build ' + SLICK_BUILD : 'Development build';

  if (typeof app.setAboutPanelOptions === 'function' && typeof app.showAboutPanel === 'function') {
    app.setAboutPanelOptions({
      applicationName: 'Slick',
      applicationVersion: SLICK_VERSION,
      version: build,
      copyright: 'Last checked for Slick updates: ' + lastChecked,
      website: RELEASES_URL,
    });
    app.showAboutPanel();
    return;
  }

  dialog.showMessageBox({
    type: 'info',
    title: 'About Slick',
    message: 'Slick',
    detail: 'Version ' + SLICK_VERSION + '\\n' + build + '\\nLast checked for Slick updates: ' + lastChecked,
    buttons: ['OK'],
  }).catch(() => {});
}

function isSlackAboutItem(item) {
  const label = String((item && item.label) || '');
  return item && (item.role === 'about' || /^About\\s+Slack$/i.test(label));
}

function isUpdateItem(item) {
  return item && /check for updates/i.test(String(item.label || ''));
}

function patchMenuTemplate(template) {
  if (process.platform !== 'darwin' || !Array.isArray(template)) return template;
  const appMenu = template[0];
  if (!appMenu || !Array.isArray(appMenu.submenu)) return template;

  return template.map((item, index) => {
    if (index !== 0) return item;
    return {
      ...item,
      label: 'Slick',
      submenu: item.submenu.flatMap((child) => {
        if (isUpdateItem(child)) return [];
        if (!isSlackAboutItem(child)) return [child];
        const about = { ...child };
        delete about.role;
        return [
          { ...about, label: 'About Slick', click: showAbout },
          { label: 'Check for Updates…', click: () => manualCheckForUpdates() },
        ];
      }),
    };
  });
}

function patchMenu(menu) {
  if (process.platform !== 'darwin' || !menu) return menu;
  const item = menu.items && menu.items[0];
  const submenu = item && item.submenu;
  if (!submenu || !submenu.items) return menu;
  const about = submenu.items.find(isSlackAboutItem);
  if (about) {
    about.label = 'About Slick';
    about.click = showAbout;
  }
  const anchor = about || submenu.items.find(isUpdateItem);
  let kept = false;
  for (const i of submenu.items) {
    if (!isUpdateItem(i)) continue;
    if (!kept) {
      i.label = 'Check for Updates…';
      i.click = () => manualCheckForUpdates();
      kept = true;
    } else if (typeof i.visible === 'boolean') {
      i.visible = false; // MenuItem has no remove(); hide the duplicate
    }
  }
  if (!kept && MenuItem && anchor) {
    const at = submenu.items.indexOf(anchor) + 1;
    submenu.insert(at, new MenuItem({ label: 'Check for Updates…', click: () => manualCheckForUpdates() }));
  }
  return menu;
}

function installPatch() {
  if (process.platform !== 'darwin' || !Menu) return;

  const buildFromTemplate = Menu.buildFromTemplate.bind(Menu);
  Menu.buildFromTemplate = (template) => buildFromTemplate(patchMenuTemplate(template));

  const setApplicationMenu = Menu.setApplicationMenu.bind(Menu);
  Menu.setApplicationMenu = (menu) => setApplicationMenu(patchMenu(menu));
}

function releaseBuild(release) {
  const match = /^v([1-9]\\d*)$/.exec(String(release && release.tag_name || '').trim());
  return match ? parseInt(match[1], 10) : 0;
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      LATEST_RELEASE_API,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Slick/' + SLICK_VERSION + ' Build ' + SLICK_BUILD,
        },
      },
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

function appBundlePath() {
  // .../Slick.app/Contents/MacOS/Electron -> .../Slick.app
  return path.resolve(process.execPath, '..', '..', '..');
}

function p(release) {
  const s = process.arch === 'arm64' ? '-arm64.zip' : '-x64.zip';
  return ((release && release.assets) || []).find((a) => a && typeof a.name === 'string' && a.name.indexOf('win32') === -1 && a.name.endsWith(s)) || null;
}

function psq(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const get = (u, redirects) => {
      https.get(u, { headers: { 'User-Agent': 'Slick/' + SLICK_VERSION } }, (res) => {
        if (res.statusCode > 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects > 5) { reject(new Error('too many redirects')); return; }
          get(res.headers.location, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); reject(new Error('download returned HTTP ' + res.statusCode)); return; }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const file = fs.createWriteStream(dest);
        res.on('data', (chunk) => { received += chunk.length; if (total) onProgress(received / total); });
        res.on('error', reject);
        file.on('error', reject);
        file.on('finish', () => file.close(() => resolve()));
        res.pipe(file);
      }).on('error', reject);
    };
    get(url, 0);
  });
}

function setp(frac) {
  const w = BrowserWindow.getAllWindows().find((x) => x && !x.isDestroyed());
  if (w) { try { w.setProgressBar(frac); } catch {} }
}

function ins(stageApp) {
  const appPath = appBundlePath();
  // Wait for this process to exit, swap the bundle in place, relaunch. Roll back on failure.
  const sh = 'APP="$1"; STAGE="$2"; PID="$3"; while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done; rm -rf "$APP.old"; mv "$APP" "$APP.old" 2>/dev/null || true; if /usr/bin/ditto "$STAGE" "$APP"; then rm -rf "$APP.old"; else rm -rf "$APP"; mv "$APP.old" "$APP" 2>/dev/null || true; fi; rm -rf "$(dirname "$STAGE")"; open "$APP"';
  const child = require('child_process').spawn('/bin/sh', ['-c', sh, 'slick-updater', appPath, stageApp, String(process.pid)], { detached: true, stdio: 'ignore' });
  child.unref();
}

async function perf(release) {
  const asset = p(release);
  if (!asset || !asset.browser_download_url) return shell.openExternal(release.html_url || RELEASES_URL);
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'slick-update-'));
  const zip = path.join(dir, asset.name);
  let stageApp;
  try {
    setp(0);
    await psq(asset.browser_download_url, zip, (f) => setp(f * 0.9));
    setp(0.95);
    require('child_process').execFileSync('/usr/bin/ditto', ['-x', '-k', zip, dir]);
    stageApp = path.join(dir, 'Slick.app');
    if (!fs.existsSync(stageApp)) throw new Error('update archive did not contain Slick.app');
    setp(1);
  } catch (err) {
    setp(-1);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    return dialog.showMessageBox({
      type: 'error',
      title: 'Slick update failed',
      message: 'Could not download the update',
      detail: String((err && err.message) || err) + '. You can download it manually instead.',
      buttons: ['Open Release Page', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => { if (response === 0) shell.openExternal(release.html_url || RELEASES_URL); }).catch(() => {});
  }

  setp(-1);
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Slick update ready',
    message: 'Slick Build ' + releaseBuild(release) + ' is ready to install',
    detail: 'Slick will restart to finish updating.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    ins(stageApp);
    app.quit();
    return;
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
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
  if (
    promptState.lastPromptedBuild === latestBuild &&
    now - (promptState.lastPromptedAt || 0) < UPDATE_CHECK_INTERVAL
  ) {
    return;
  }
  writeUpdateState({ ...promptState, lastPromptedBuild: latestBuild, lastPromptedAt: Date.now() });

  promptDownload(release, latestBuild);
}

function promptDownload(release, latestBuild) {
  return dialog.showMessageBox({
    type: 'info',
    title: 'Slick update available',
    message: 'Slick Build ' + latestBuild + ' is available',
    detail: 'You are running Build ' + SLICK_BUILD + '. Download it now and Slick will install it on the next restart.',
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
  }).then(({ response }) => {
    if (response === 0) return perf(release);
    return undefined;
  }).catch(() => {});
}

async function manualCheckForUpdates() {
  if (!SLICK_BUILD) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Slick updates',
      message: 'Update checking is unavailable',
      detail: 'This is a development build, so Slick cannot check for updates.',
      buttons: ['OK'],
    }).catch(() => {});
    return;
  }

  let release;
  try {
    writeUpdateState({ ...readUpdateState(), lastCheckedAt: Date.now() });
    release = await fetchLatestRelease();
  } catch (err) {
    dialog.showMessageBox({
      type: 'error',
      title: 'Slick update check failed',
      message: 'Could not check for updates',
      detail: String((err && err.message) || err) + '. Try again later.',
      buttons: ['OK'],
    }).catch(() => {});
    return;
  }

  const latestBuild = releaseBuild(release);
  if (latestBuild <= SLICK_BUILD) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Slick is up to date',
      message: "You're running the latest version of Slick",
      detail: 'Build ' + SLICK_BUILD + ' is the newest available.',
      buttons: ['OK'],
    }).catch(() => {});
    return;
  }

  writeUpdateState({ ...readUpdateState(), lastPromptedBuild: latestBuild, lastPromptedAt: Date.now() });
  promptDownload(release, latestBuild);
}

function scheduleUpdateChecks() {
  if (!SLICK_BUILD) return;
  const run = () => {
    checkForUpdates();
    setTimeout(run, UPDATE_CHECK_INTERVAL);
  };
  app.whenReady().then(() => {
    const state = readUpdateState();
    const elapsed = Date.now() - (state.lastCheckedAt || 0);
    const delay = state.lastCheckedAt
      ? Math.max(STARTUP_UPDATE_DELAY, UPDATE_CHECK_INTERVAL - elapsed)
      : STARTUP_UPDATE_DELAY;
    setTimeout(run, delay);
  }).catch(() => {});
}

if (!preflight()) {
  app.exit(1);
} else {
  app.setPath('userData', PROFILE);
  installPatch();
  seedSettings();
  scheduleUpdateChecks();

  try {
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: SLACK_RESOURCES });
  } catch {}

  const getAppPath = app.getAppPath.bind(app);
  app.getAppPath = () => process.env.SLICK_HANDOFF_KEEP_WRAPPER_APP_PATH === '1' ? getAppPath() : SLACK_ASAR;

  require(path.join(SLICK_ROOT, 'scripts/byoe/login-handoff.js'));
  require(path.join(SLICK_ROOT, 'scripts/byoe/inject.js'));
  require(SLACK_ASAR);
}
`,
    },
  ];
  fs.rmSync(path.join(res, 'app'), { recursive: true, force: true });
  for (const name of ['default_app.asar', 'app.asar']) packAsar(files, path.join(res, name));

  const codesignArgs = ['--force', '--deep', '--sign', '-'];
  if (fs.existsSync(ENTITLEMENTS)) codesignArgs.push('--entitlements', ENTITLEMENTS);
  codesignArgs.push(target);
  run('/usr/bin/codesign', codesignArgs);

  console.log(JSON.stringify({ app: target, profile, note: 'Open this to register slack:// to Slick' }, null, 2));
}

try {
  main();
} catch (e) {
  console.error(e?.stack || e);
  process.exit(1);
}
