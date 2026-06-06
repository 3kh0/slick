#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_APP = path.join(ROOT, 'byoe/node_modules/electron/dist/Electron.app');
const SLACK_RESOURCES = '/Applications/Slack.app/Contents/Resources';
const SLACK_ASAR = path.join(SLACK_RESOURCES, 'app.asar');
const DEFAULTS = { target: '/tmp/slick/Slick.app', profile: '/tmp/slick/profile', force: false, allowNonTmp: false };

function usage() {
  console.error(`Usage:
  node scripts/byoe/build-handoff-app.js [--target <app>] [--profile <dir>] [--force] [--allow-non-tmp]

Defaults:
  --target  ${DEFAULTS.target}
  --profile ${DEFAULTS.profile}`);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--target') o.target = argv[++i] || usage();
    else if (argv[i] === '--profile') o.profile = argv[++i] || usage();
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
    'scripts/byoe/login-handoff.js',
    'scripts/byoe/plugins.js',
    'scripts/byoe/settings-renderer.js',
    'scripts/byoe/settings-ui.js',
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

  if (!fs.existsSync(SOURCE_APP)) throw new Error(`BYOE Electron missing at ${SOURCE_APP}`);
  if (!fs.existsSync(SLACK_ASAR)) throw new Error(`Slack ASAR missing at ${SLACK_ASAR}`);
  if (!opts.allowNonTmp && !target.startsWith('/tmp/') && !target.startsWith('/private/tmp/')) {
    throw new Error('prototype tg must be at under /tmp unless --allow-non-tmp is here, and its fucking not');
  }
  if (fs.existsSync(target)) {
    if (!opts.force) throw new Error(`${target} already there; rerun with --force if you wanna kill it`);
    fs.rmSync(target, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(SOURCE_APP, target, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });

  const res = path.join(target, 'Contents/Resources');
  const plist = path.join(target, 'Contents/Info.plist');
  for (const [k, v] of Object.entries({
    CFBundleIdentifier: 'dev.slick.byoe.handoff',
    CFBundleName: 'Slick',
    CFBundleDisplayName: 'Slick',
    CFBundleExecutable: 'Electron',
    CFBundleShortVersionString: '0.0.1',
    CFBundleVersion: '0.0.1',
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
      contents: `${JSON.stringify({ name: 'slick', productName: 'Slick', version: '0.0.1', main: 'index.js' }, null, 2)}\n`,
    },
    {
      name: 'index.js',
      contents: `'use strict';

const path = require('path');
const { app } = require('electron');

const SLICK_ROOT = path.join(process.resourcesPath, 'slick');
const PROFILE = process.env.SLICK_HANDOFF_PROFILE || ${JSON.stringify(profile)};
const SLACK_RESOURCES = ${JSON.stringify(SLACK_RESOURCES)};
const SLACK_ASAR = ${JSON.stringify(SLACK_ASAR)};

app.setPath('userData', PROFILE);

try {
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: SLACK_RESOURCES });
} catch {}

const getAppPath = app.getAppPath.bind(app);
app.getAppPath = () => process.env.SLICK_HANDOFF_KEEP_WRAPPER_APP_PATH === '1' ? getAppPath() : SLACK_ASAR;

require(path.join(SLICK_ROOT, 'scripts/byoe/login-handoff.js'));
require(path.join(SLICK_ROOT, 'scripts/byoe/inject.js'));
require(SLACK_ASAR);
`,
    },
  ];
  fs.rmSync(path.join(res, 'app'), { recursive: true, force: true });
  for (const name of ['default_app.asar', 'app.asar']) packAsar(files, path.join(res, name));

  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', target]);

  console.log(
    JSON.stringify(
      {
        app: target,
        profile,
        note: 'Open this to register slack:// to Slick',
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
