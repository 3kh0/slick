// Slick's Slack Updater
//
// Ported from scripts/byoe/slack-updater.js with its logic intact.
//
// Slick launches by require()-ing Slack's app.asar out of the installed Slack
// app, and patch.ts neuters Slack's own autoUpdater -- which would otherwise
// try to update the *running* bundle, Slick, rather than Slack. Without this
// file a Slick user would sit on whatever Slack version was installed forever,
// eventually tripping the Electron-major preflight or Slack's server-side
// minimum-version wall.
//
// The strategy is stage-then-swap-at-boot: ask Slack's public download redirect
// for the latest version, and if it is newer *and* bundles the same Electron
// major Slick was built against, download, verify and stage it. The swap
// happens at the next launch, before the asar is required, so the bundle is
// never replaced under a running session.
//
// Only macOS is implemented. Every step here is darwin-shaped -- the app path,
// the plist reads, ditto, codesign, and the download URL -- so the other
// platforms get inert stubs rather than a half-working implementation.

import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { settingsDir } from './paths.js';

const MAC = process.platform === 'darwin';
const FRAMEWORK_PLIST_REL = 'Contents/Frameworks/Electron Framework.framework/Resources/Info.plist';
const SLACK_BUNDLE_ID = 'com.tinyspeck.slackmacgap';
const LATEST_REDIRECT = 'https://slack.com/ssb/download-osx-universal';
const VERSION_RE = /desktop-releases\/mac\/[^/]+\/(\d+\.\d+\.\d+)\//;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const log = (message: string) => console.log(`[slick-slack-updater] ${message}`);
const reason = (error: unknown) => String((error as Error)?.message ?? error);
const slickElectronMajor = () => Number.parseInt(process.versions.electron, 10) || 0;

export function cmpVersion(a: string, b: string): -1 | 0 | 1 {
  const pa = String(a)
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b)
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function plistValue(plist: string, key: string): string {
  try {
    return execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const electronMajorOf = (appPath: string) =>
  Number.parseInt(plistValue(path.join(appPath, FRAMEWORK_PLIST_REL), 'CFBundleVersion'), 10) || 0;
const bundleIdOf = (appPath: string) => plistValue(path.join(appPath, 'Contents/Info.plist'), 'CFBundleIdentifier');

/** Cheap rename within a volume, ditto copy across one. */
function moveDir(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch {
    execFileSync('/usr/bin/ditto', [from, to]);
  }
}

type Marker = { version?: string; electronMajor?: number };

export type SlackUpdater = {
  applyStagedIfAny: () => void;
  checkNow: () => Promise<void>;
  scheduleChecks: () => void;
  latestVersion: () => Promise<string>;
  installedVersion: () => string;
};

export function createSlackUpdater({
  version,
  slackApp = '/Applications/Slack.app',
}: {
  version: string;
  slackApp?: string;
}): SlackUpdater {
  const slackInfoPlist = path.join(slackApp, 'Contents/Info.plist');
  const installedVersion = () => plistValue(slackInfoPlist, 'CFBundleShortVersionString');

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
  const stagingDir = path.join(settingsDir(), 'slack-staging');
  const stagedApp = path.join(stagingDir, 'Slack.app');
  const markerPath = path.join(stagingDir, 'staged.json');

  const readMarker = (): Marker | null => {
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

  function latestVersion(): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.get(LATEST_REDIRECT, { headers: { 'User-Agent': ua } }, (res) => {
        res.resume();
        const match = VERSION_RE.exec(res.headers.location || '');
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && match) resolve(match[1]);
        else reject(new Error(`unexpected latest-version response HTTP ${status}`));
      });
      req.setTimeout(15000, () => req.destroy(new Error('latest-version check timed out')));
      req.on('error', reject);
    });
  }

  function download(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const get = (u: string, redirects: number) => {
        https
          .get(u, { headers: { 'User-Agent': ua } }, (res) => {
            const status = res.statusCode ?? 0;
            if (status > 300 && status < 400 && res.headers.location) {
              res.resume();
              if (redirects > 5) reject(new Error('too many redirects'));
              else get(res.headers.location, redirects + 1);
              return;
            }
            if (status !== 200) {
              res.resume();
              reject(new Error(`download returned HTTP ${status}`));
              return;
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

  const extract = (zip: string, dir: string) =>
    new Promise<void>((resolve, reject) =>
      execFile('/usr/bin/ditto', ['-x', '-k', zip, dir], (error) => (error ? reject(error) : resolve())),
    );

  const verifyCodesign = (appPath: string) =>
    new Promise<boolean>((resolve) =>
      execFile('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], (error) => resolve(!error)),
    );

  /**
   * Called synchronously at boot, before Slick require()s Slack's asar. Swaps a
   * previously staged Slack.app into place if it is still valid.
   */
  function applyStagedIfAny(): void {
    const marker = readMarker();
    if (!marker?.version) return;
    if (!fs.existsSync(stagedApp)) {
      clearStaging();
      return;
    }

    // Stale guards: something newer was installed by other means, or the staged
    // build no longer matches Slick's Electron major because Slick moved.
    const installed = installedVersion();
    if (installed && cmpVersion(marker.version, installed) <= 0) {
      log(`staged Slack ${marker.version} <= installed ${installed}; discarding`);
      clearStaging();
      return;
    }
    if (marker.electronMajor && marker.electronMajor !== slickElectronMajor()) {
      log(`staged Slack Electron ${marker.electronMajor} != Slick ${slickElectronMajor()}; discarding`);
      clearStaging();
      return;
    }

    const backup = `${slackApp}.slick-old`;
    try {
      fs.rmSync(backup, { recursive: true, force: true });
      if (fs.existsSync(slackApp)) fs.renameSync(slackApp, backup);
      moveDir(stagedApp, slackApp);
      fs.rmSync(backup, { recursive: true, force: true });
      log(`installed Slack ${marker.version}`);
    } catch (error) {
      // Restore whatever was moved: the user must never be left without Slack.
      try {
        if (!fs.existsSync(slackApp) && fs.existsSync(backup)) fs.renameSync(backup, slackApp);
      } catch {}
      log(`failed to install staged Slack: ${reason(error)}`);
    } finally {
      clearStaging();
    }
  }

  async function checkNow(): Promise<void> {
    let latest: string;
    try {
      latest = await latestVersion();
    } catch (error) {
      log(`latest-version check failed: ${reason(error)}`);
      return;
    }

    const installed = installedVersion();
    if (!installed) {
      log('could not read installed Slack version; skipping');
      return;
    }
    if (cmpVersion(latest, installed) <= 0) {
      if (readMarker()) clearStaging();
      return;
    }

    const staged = readMarker();
    if (staged?.version === latest && fs.existsSync(stagedApp)) return; // already staged for the next boot

    log(`Slack ${latest} available (installed ${installed}); downloading`);
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const url = `https://downloads.slack-edge.com/desktop-releases/mac/${arch}/${latest}/Slack-${latest}-macOS.zip`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-slack-'));
    const built = path.join(tmp, 'Slack.app');

    try {
      await download(url, path.join(tmp, 'Slack.zip'));
      await extract(path.join(tmp, 'Slack.zip'), tmp);
      if (!fs.existsSync(built)) throw new Error('archive did not contain Slack.app');

      const bundleId = bundleIdOf(built);
      if (bundleId !== SLACK_BUNDLE_ID) throw new Error(`downloaded app has unexpected bundle id ${bundleId}`);

      const downloadedMajor = electronMajorOf(built);
      if (downloadedMajor && downloadedMajor !== slickElectronMajor()) {
        // Installing this would trip Slick's own Electron-major preflight and
        // block launch. Leave Slack alone; once Slick ships a matching Electron
        // this check runs again and picks it up.
        log(
          `Slack ${latest} bundles Electron ${downloadedMajor} but Slick is on ${slickElectronMajor()}; skipping until Slick updates`,
        );
        return;
      }

      if (!(await verifyCodesign(built))) throw new Error('codesign verification failed');

      fs.mkdirSync(stagingDir, { recursive: true });
      fs.rmSync(stagedApp, { recursive: true, force: true });
      moveDir(built, stagedApp);
      fs.writeFileSync(
        markerPath,
        `${JSON.stringify({ version: latest, electronMajor: downloadedMajor || slickElectronMajor() }, null, 2)}\n`,
      );
      log(`staged Slack ${latest}; will install on next launch`);
    } catch (error) {
      log(`update failed: ${reason(error)}`);
    } finally {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {}
    }
  }

  function scheduleChecks(): void {
    const run = () => {
      checkNow().catch(() => {});
      setTimeout(run, CHECK_INTERVAL_MS).unref?.();
    };
    // Offset from Slick's own updater so the two network checks do not fire
    // together at launch.
    setTimeout(run, 90_000).unref?.();
  }

  return { applyStagedIfAny, checkNow, scheduleChecks, latestVersion, installedVersion };
}
