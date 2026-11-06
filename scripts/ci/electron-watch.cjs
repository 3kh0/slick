'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const LATEST_REDIRECT = 'https://slack.com/ssb/download-osx-universal';
const VERSION_RE = /desktop-releases\/mac\/[^/]+\/(\d+\.\d+\.\d+)\//;
const FRAMEWORK_PLIST = 'Slack.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist';
const UA = 'slick-electron-watch';

const major = (v) => parseInt(v, 10) || 0;
function compareVersions(slackElectron, byoe) {
  for (const version of [slackElectron, byoe]) {
    if (!/^\d+\.\d+\.\d+$/.test(version) || version !== version.trim())
      throw new Error(`invalid Electron version: ${version}`);
  }
  return {
    mismatch: major(slackElectron) !== major(byoe),
    versionMismatch: slackElectron !== byoe,
  };
}
const die = (m) => {
  console.error(`electron-watch: ${m}`);
  process.exit(1);
};

function get(url, onResponse, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': UA } }, (res) => {
        const { statusCode, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume();
          if (redirects > 5) return reject(new Error('too many redirects'));
          return get(headers.location, onResponse, redirects + 1).then(resolve, reject);
        }
        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode} for ${url}`));
        }
        onResponse(res, resolve, reject);
      })
      .on('error', reject);
  });
}

const download = (url, dest) =>
  get(url, (res, resolve, reject) => {
    const file = fs.createWriteStream(dest);
    res.on('error', reject);
    file.on('error', reject);
    file.on('finish', () => file.close(() => resolve()));
    res.pipe(file);
  });

// The redirect's Location carries the newest published version; we never follow it here.
function latestSlackVersion() {
  return new Promise((resolve, reject) => {
    const req = https.get(LATEST_REDIRECT, { headers: { 'User-Agent': UA } }, (res) => {
      res.resume();
      const match = VERSION_RE.exec(res.headers.location || '');
      if (res.statusCode >= 300 && res.statusCode < 400 && match) resolve(match[1]);
      else reject(new Error(`unexpected latest-version response HTTP ${res.statusCode}`));
    });
    req.setTimeout(30000, () => req.destroy(new Error('latest-version check timed out')));
    req.on('error', reject);
  });
}

async function slackElectronVersion(version) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-electron-watch-'));
  try {
    const zip = path.join(tmp, 'Slack.zip');
    await download(
      `https://downloads.slack-edge.com/desktop-releases/mac/arm64/${version}/Slack-${version}-macOS.zip`,
      zip,
    );
    // Pull the single plist member rather than unpacking the whole 130MB bundle.
    execFileSync('/usr/bin/unzip', ['-o', '-q', zip, FRAMEWORK_PLIST, '-d', tmp], { stdio: 'pipe' });
    const raw = execFileSync(
      '/usr/bin/plutil',
      ['-extract', 'CFBundleVersion', 'raw', '-o', '-', path.join(tmp, FRAMEWORK_PLIST)],
      { encoding: 'utf8' },
    ).trim();
    if (!raw) throw new Error('no CFBundleVersion in the Electron framework plist');
    return raw;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  if (process.platform !== 'darwin') die('needs macOS (plutil)');

  const byoe = require(path.join(ROOT, 'package.json')).devDependencies.electron.replace(/[^\d.]/g, '');
  const slackVersion = await latestSlackVersion().catch((e) => die(e.message));
  const slackElectron = await slackElectronVersion(slackVersion).catch((e) => die(e.message));

  const { mismatch, versionMismatch } = compareVersions(slackElectron, byoe);

  console.log(`Slack ${slackVersion} ships Electron ${slackElectron}`);
  console.log(`package.json pins Electron ${byoe}`);
  console.log(mismatch ? `MISMATCH: major ${major(slackElectron)} != ${major(byoe)}` : 'majors match');
  console.log(versionMismatch ? `VERSION MISMATCH: ${slackElectron} != ${byoe}` : 'versions match');

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `mismatch=${mismatch}`,
        `version_mismatch=${versionMismatch}`,
        `slack_version=${slackVersion}`,
        `slack_electron=${slackElectron}`,
        `slack_major=${major(slackElectron)}`,
        `byoe_electron=${byoe}`,
        `byoe_major=${major(byoe)}`,
        `suggested=${versionMismatch ? slackElectron : ''}`,
        '',
      ].join('\n'),
    );
  }
}

module.exports = { compareVersions };
if (require.main === module) main().catch((error) => die(error.message));
