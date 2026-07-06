'use strict';

// Keeps the underlying Slack install up to date.
//
// Slick launches by require()-ing Slack's app.asar out of the installed Slack app, but it
// replaces Slack's own updater UI and neuters Slack's autoUpdater (which would otherwise
// try to update the *running* bundle — Slick — not Slack). So without this, a Slick-only
// user would sit on whatever Slack version was installed forever, eventually tripping the
// Electron-major preflight or Slack's server-side min-version wall.
//
// Strategy: on Slick's existing background cadence, ask Slack's public download redirect
// for the latest version. If newer than what's installed AND it bundles the same Electron
// major Slick was built against, download + extract + verify it and STAGE it. The actual
// swap into place happens at the next Slick boot (applyStagedIfAny), before the asar is
// required, so we never swap the asar out from under a running session.
//
// Platform surface for Windows/Linux later: SLACK_APP path, the plist reads (version /
// electron-major / bundle-id), the extract + moveDir commands, the latest-version probe,
// and the download URL are all darwin-shaped. Only darwin is implemented; create() returns
// inert stubs elsewhere, so wiring it into the Win/Linux handoff builds is safe today.

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFile, execFileSync } = require('child_process');

const MAC = process.platform === 'darwin';
const SLACK_APP = '/Applications/Slack.app';
const SLACK_INFO_PLIST = path.join(SLACK_APP, 'Contents/Info.plist');
const FRAMEWORK_PLIST_REL = 'Contents/Frameworks/Electron Framework.framework/Resources/Info.plist';
const SLACK_BUNDLE_ID = 'com.tinyspeck.slackmacgap';
const LATEST_REDIRECT = 'https://slack.com/ssb/download-osx-universal';
const VERSION_RE = /desktop-releases\/mac\/[^/]+\/(\d+\.\d+\.\d+)\//;
const CINT = 6 * 60 * 60 * 1000;

const log = (m) => console.log(`[slick-slack-updater] ${m}`);
const msg = (e) => (e && e.message) || e;
const slickElectronMajor = () => parseInt(process.versions.electron, 10) || 0;

function cmpVersion(a, b) {
  const pa = String(a)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function plistValue(plist, key) {
  try {
    return execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}
const electronMajorOf = (app) => parseInt(plistValue(path.join(app, FRAMEWORK_PLIST_REL), 'CFBundleVersion'), 10) || 0;
const bundleIdOf = (app) => plistValue(path.join(app, 'Contents/Info.plist'), 'CFBundleIdentifier');
const installedVersion = () => plistValue(SLACK_INFO_PLIST, 'CFBundleShortVersionString');

// Move a bundle dir onto another path: cheap rename within a volume, ditto copy across.
function moveDir(from, to) {
  try {
    fs.renameSync(from, to);
  } catch {
    execFileSync('/usr/bin/ditto', [from, to]);
  }
}

function create({ profile, version }) {
  if (!MAC) {
    const noop = () => {};
    return {
      applyStagedIfAny: noop,
      scheduleChecks: noop,
      checkNow: async () => {},
      latestVersion: async () => '',
      installedVersion,
    };
  }

  const ua = `Slick/${version || '0'}`;
  const stagingDir = path.join(profile, 'slick', 'slack-staging');
  const stagedApp = path.join(stagingDir, 'Slack.app');
  const markerPath = path.join(stagingDir, 'staged.json');

  const readMarker = () => {
    try {
      return JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    } catch {
      return null;
    }
  };
  const clearStaging = () => {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {}
  };

  function latestVersion() {
    return new Promise((resolve, reject) => {
      const req = https.get(LATEST_REDIRECT, { headers: { 'User-Agent': ua } }, (res) => {
        res.resume();
        const match = VERSION_RE.exec(res.headers.location || '');
        if (res.statusCode >= 300 && res.statusCode < 400 && match) resolve(match[1]);
        else reject(new Error(`unexpected latest-version response HTTP ${res.statusCode}`));
      });
      req.setTimeout(15000, () => req.destroy(new Error('latest-version check timed out')));
      req.on('error', reject);
    });
  }

  function download(url, dest) {
    return new Promise((resolve, reject) => {
      const get = (u, redirects) => {
        https
          .get(u, { headers: { 'User-Agent': ua } }, (res) => {
            const { statusCode, headers } = res;
            if (statusCode > 300 && statusCode < 400 && headers.location) {
              res.resume();
              return redirects > 5 ? reject(new Error('too many redirects')) : get(headers.location, redirects + 1);
            }
            if (statusCode !== 200) {
              res.resume();
              return reject(new Error(`download returned HTTP ${statusCode}`));
            }
            const file = fs.createWriteStream(dest);
            res.on('error', reject);
            file.on('error', reject);
            file.on('finish', () => file.close(() => resolve()));
            res.pipe(file);
          })
          .on('error', reject);
      };
      get(url, 0);
    });
  }

  const extract = (zip, dir) =>
    new Promise((resolve, reject) =>
      execFile('/usr/bin/ditto', ['-x', '-k', zip, dir], (e) => (e ? reject(e) : resolve())),
    );
  const verifyCodesign = (app) =>
    new Promise((resolve) =>
      execFile('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], (e) => resolve(!e)),
    );

  // Called synchronously at boot, BEFORE Slick require()s Slack's asar. Swaps a previously
  // staged Slack.app into place if it's still valid.
  function applyStagedIfAny() {
    const marker = readMarker();
    if (!marker || !marker.version) return;
    if (!fs.existsSync(stagedApp)) return clearStaging();

    // Stale guards: already installed something >= staged, or the staged build no longer
    // matches Slick's Electron major (e.g. Slick was itself downgraded).
    const installed = installedVersion();
    if (installed && cmpVersion(marker.version, installed) <= 0)
      return (log(`staged Slack ${marker.version} <= installed ${installed}; discarding`), clearStaging());
    if (marker.electronMajor && marker.electronMajor !== slickElectronMajor())
      return (
        log(`staged Slack Electron ${marker.electronMajor} != Slick ${slickElectronMajor()}; discarding`),
        clearStaging()
      );

    const backup = `${SLACK_APP}.slick-old`;
    try {
      fs.rmSync(backup, { recursive: true, force: true });
      if (fs.existsSync(SLACK_APP)) fs.renameSync(SLACK_APP, backup);
      moveDir(stagedApp, SLACK_APP);
      fs.rmSync(backup, { recursive: true, force: true });
      log(`installed Slack ${marker.version}`);
    } catch (e) {
      // Restore whatever we moved so the user is never left without Slack.
      try {
        if (!fs.existsSync(SLACK_APP) && fs.existsSync(backup)) fs.renameSync(backup, SLACK_APP);
      } catch {}
      log(`failed to install staged Slack: ${msg(e)}`);
    } finally {
      clearStaging();
    }
  }

  async function checkNow() {
    let latest;
    try {
      latest = await latestVersion();
    } catch (e) {
      return log(`latest-version check failed: ${msg(e)}`);
    }
    const installed = installedVersion();
    if (!installed) return log('could not read installed Slack version; skipping');
    if (cmpVersion(latest, installed) <= 0) return void (readMarker() && clearStaging()); // nothing newer

    const staged = readMarker();
    if (staged && staged.version === latest && fs.existsSync(stagedApp)) return; // already staged, waiting for boot

    log(`Slack ${latest} available (installed ${installed}); downloading`);
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const url = `https://downloads.slack-edge.com/desktop-releases/mac/${arch}/${latest}/Slack-${latest}-macOS.zip`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-slack-'));
    const built = path.join(tmp, 'Slack.app');
    try {
      await download(url, path.join(tmp, 'Slack.zip'));
      await extract(path.join(tmp, 'Slack.zip'), tmp);
      if (!fs.existsSync(built)) throw new Error('archive did not contain Slack.app');

      const bid = bundleIdOf(built);
      if (bid !== SLACK_BUNDLE_ID) throw new Error(`downloaded app has unexpected bundle id ${bid}`);

      const dlMajor = electronMajorOf(built);
      if (dlMajor && dlMajor !== slickElectronMajor()) {
        // Installing this would trip Slick's Electron-major preflight and block launch. Leave
        // the current Slack alone; Slick's own updater will ship a matching Electron and this
        // re-checks once that lands.
        return log(
          `Slack ${latest} bundles Electron ${dlMajor} but Slick is on ${slickElectronMajor()}; skipping until Slick updates`,
        );
      }

      if (!(await verifyCodesign(built))) throw new Error('codesign verification failed');

      fs.mkdirSync(stagingDir, { recursive: true });
      fs.rmSync(stagedApp, { recursive: true, force: true });
      moveDir(built, stagedApp);
      fs.writeFileSync(
        markerPath,
        `${JSON.stringify({ version: latest, electronMajor: dlMajor || slickElectronMajor() }, null, 2)}\n`,
      );
      log(`staged Slack ${latest}; will install on next launch`);
    } catch (e) {
      log(`update failed: ${msg(e)}`);
    } finally {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {}
    }
  }

  function scheduleChecks() {
    const run = () => {
      checkNow().catch(() => {});
      setTimeout(run, CINT).unref?.();
    };
    // Offset from Slick's own updater so the two network checks don't fire together.
    setTimeout(run, 90 * 1000).unref?.();
  }

  return { applyStagedIfAny, checkNow, scheduleChecks, latestVersion, installedVersion };
}

module.exports = { create, cmpVersion };
