#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

const LINUX_SLACK_PATHS = [
  '/usr/lib/slack',
  '/opt/Slack',
  '/opt/slack',
  `${process.env.HOME}/.local/share/slack`,
];

const SYSTEM_ELECTRON_DIRS = [
  '/usr/lib/electron42',
  '/usr/lib/electron41',
  '/usr/lib/electron39',
  '/usr/lib/electron38',
  '/usr/lib/electron',
];

const DEFAULTS = { target: path.join(ROOT, 'byoe', 'slick-linux'), force: false };

function usage() {
  console.error(`Usage:
  node scripts/byoe/build-handoff-linux.js [--target <dir>] [--force]

Defaults:
  --target  ${DEFAULTS.target}`);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--target') o.target = argv[++i] || usage();
    else if (argv[i] === '--force') o.force = true;
    else usage();
  }
  return o;
}

function findSlack() {
  for (const p of LINUX_SLACK_PATHS) {
    const asar = path.join(p, 'resources', 'app.asar');
    if (fs.existsSync(asar)) return p;
  }
  return null;
}

function getElectronVersion(slackDir) {
  const versionFile = path.join(slackDir, 'version');
  if (fs.existsSync(versionFile)) {
    return fs.readFileSync(versionFile, 'utf8').trim();
  }
  const bin = path.join(slackDir, 'slack');
  if (fs.existsSync(bin)) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
    const m = (r.stdout || '').match(/(\d+\.\d+\.\d+)/);
    if (m) return m[1];
  }
  return null;
}

function findBestElectron(slackMajor) {
  for (const dir of SYSTEM_ELECTRON_DIRS) {
    const bin = path.join(dir, 'electron');
    if (!fs.existsSync(bin)) continue;
    const ver = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
    const m = (ver.stdout || '').match(/v?(\d+)\.(\d+)\.(\d+)/);
    if (m && m[1] === String(slackMajor)) {
      return { bin, version: `${m[1]}.${m[2]}.${m[3]}`, source: 'system' };
    }
  }

  const npmBin = path.join(ROOT, 'byoe', 'node_modules', 'electron', 'dist', 'electron');
  if (fs.existsSync(npmBin)) {
    const ver = path.join(ROOT, 'byoe', 'node_modules', 'electron', 'dist', 'version');
    const v = fs.existsSync(ver) ? fs.readFileSync(ver, 'utf8').trim() : null;
    if (v && v.split('.')[0] === String(slackMajor)) {
      return { bin: npmBin, version: v, source: 'npm' };
    }
  }

  return null;
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

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = path.resolve(opts.target);

  const slackDir = findSlack();
  if (!slackDir) throw new Error('Slack not found. Install slack-desktop from AUR first.');
  const slackAsar = path.join(slackDir, 'resources', 'app.asar');
  console.log(`  Slack found at ${slackDir}`);

  const slackVersion = getElectronVersion(slackDir);
  if (!slackVersion) throw new Error('Could not determine Slack Electron version.');
  const slackMajor = slackVersion.split('.')[0];
  console.log(`  Slack ships Electron ${slackVersion}`);

  const electron = findBestElectron(slackMajor);
  if (!electron) {
    throw new Error(
      `No Electron ${slackMajor}.x found. Install electron${slackMajor}:\n` +
        `  paru -S electron${slackMajor}`,
    );
  }
  console.log(`  Using ${electron.source} Electron ${electron.version} (${electron.bin})`);

  const profile = path.join(process.env.HOME, '.config', 'slick');

  if (fs.existsSync(target)) {
    if (!opts.force) throw new Error(`${target} already exists; rerun with --force to overwrite.`);
    fs.rmSync(target, { recursive: true, force: true });
  }

  fs.mkdirSync(target, { recursive: true });

  const electronLink = path.join(target, 'electron');
  const relBin = path.relative(target, electron.bin);
  fs.symlinkSync(relBin, electronLink);

  const resDir = path.join(target, 'resources');
  fs.mkdirSync(resDir, { recursive: true });

  fs.copyFileSync(slackAsar, path.join(resDir, 'slack.asar'));
  fs.writeFileSync(path.join(resDir, '.electron-version'), slackVersion);
  fs.writeFileSync(path.join(resDir, '.electron-bin'), electron.bin);

  const unpackedSrc = path.join(slackDir, 'resources', 'app.asar.unpacked');
  if (fs.existsSync(unpackedSrc)) {
    fs.cpSync(unpackedSrc, path.join(resDir, 'slack.asar.unpacked'), { recursive: true });
  }

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

const ROOT = ${JSON.stringify(target)};
const PROFILE = process.env.SLICK_HANDOFF_PROFILE || ${JSON.stringify(profile)};
const SLACK_ASAR = path.join(ROOT, 'resources', 'slack.asar');

app.setPath('userData', PROFILE);

try {
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: path.join(path.dirname(SLACK_ASAR), '..'),
  });
} catch {}

const getAppPath = app.getAppPath.bind(app);
app.getAppPath = () =>
  process.env.SLICK_HANDOFF_KEEP_WRAPPER_APP_PATH === '1' ? getAppPath() : SLACK_ASAR;

require(path.join(ROOT, '..', '..', 'scripts', 'byoe', 'login-handoff.js'));
require(path.join(ROOT, '..', '..', 'scripts', 'byoe', 'inject.js'));
require(SLACK_ASAR);
`,
    },
  ];
  packAsar(files, path.join(resDir, 'app.asar'));

  const desktopFile = path.join(target, 'slick.desktop');
  const launchScript = path.join(ROOT, 'scripts', 'launch-linux.sh');
  fs.writeFileSync(
    desktopFile,
    `[Desktop Entry]
Name=Slick
Comment=Slack client with themes and plugins
Exec=${launchScript} %U
Icon=slick
Type=Application
StartupNotify=true
Categories=GNOME;GTK;Network;InstantMessaging;
MimeType=x-scheme-handler/slack;
Terminal=false
`,
  );

  console.log(
    JSON.stringify(
      {
        app: target,
        profile,
        slackDir,
        electron: electron.bin,
        electronVersion: electron.version,
        electronSource: electron.source,
        note: 'Run the launcher or use the .desktop file to start Slick',
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
