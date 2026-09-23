// Updates the installed Slack. patch.ts neuters Slack's own autoUpdater (it
// would try to update the running bundle, Slick), so without this Slack would
// fall behind until it hit the Electron-major preflight or Slack's server-side
// minimum-version wall.
//
// macOS: stage-then-swap-at-boot. A newer Slack with the same Electron major as
// Slick is downloaded, verified and staged, then swapped in at the next launch
// before the asar is required, never under a running session.
//
// Windows: standalone Slack is Squirrel, so Update.exe installs a new
// `app-<ver>` dir from Slack's feed (hash-verified) and slackFinder.ts picks the
// newest at next launch. MSIX Slack is left to the Store.
//
// Linux: the package manager keeps Slack current.

import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { settingsDir } from './paths.js';

const MAC = process.platform === 'darwin';
const FRAMEWORK_PLIST_REL = 'Contents/Frameworks/Electron Framework.framework/Resources/Info.plist';
const SLACK_BUNDLE_ID = 'com.tinyspeck.slackmacgap';
// Slack's Developer ID team: a valid signature alone only proves *someone*
// signed the bundle.
const SLACK_REQUIREMENT = 'anchor apple generic and certificate leaf[subject.OU] = "BQR82RBBHL"';
const LATEST_REDIRECT = 'https://slack.com/ssb/download-osx-universal';
const VERSION_RE = /desktop-releases\/mac\/[^/]+\/(\d+\.\d+\.\d+)\//;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** A download that stops delivering bytes for this long is abandoned. */
const STALL_MS = 60_000;

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

  if (process.platform === 'win32') return createWindowsSlackUpdater(`Slick/${version || '0'}`);
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
          .on('error', reject)
          // Otherwise a stalled connection hangs the check forever.
          .setTimeout(STALL_MS, function (this: import('node:http').ClientRequest) {
            this.destroy(new Error('download stalled'));
          });
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
      execFile('/usr/bin/codesign', ['--verify', '--deep', '--strict', `-R=${SLACK_REQUIREMENT}`, appPath], (error) =>
        resolve(!error),
      ),
    );

  /** Must run synchronously at boot, before Slack's asar is required. */
  function applyStagedIfAny(): void {
    const marker = readMarker();
    if (!marker?.version) return;
    if (!fs.existsSync(stagedApp)) {
      clearStaging();
      return;
    }

    // Stale if something newer was installed meanwhile, or Slick's Electron
    // major moved.
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

    // Moving the bundle under a running official Slack breaks that session.
    if (slackRunning()) {
      log(`Slack is running; leaving staged ${marker.version} for the next launch`);
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
      // Never leave the user without Slack.
      try {
        if (!fs.existsSync(slackApp) && fs.existsSync(backup)) fs.renameSync(backup, slackApp);
      } catch {}
      log(`failed to install staged Slack: ${reason(error)}`);
    } finally {
      clearStaging();
    }
  }

  const slackRunning = () => {
    try {
      execFileSync('/usr/bin/pgrep', ['-f', `${slackApp}/Contents/MacOS/Slack`], { stdio: 'ignore' });
      return true;
    } catch {
      return false; // pgrep exits 1 when nothing matches
    }
  };

  let checking = false;

  async function checkNow(): Promise<void> {
    if (checking) return;
    checking = true;
    try {
      await check();
    } finally {
      checking = false;
    }
  }

  async function check(): Promise<void> {
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
        // Would trip the Electron-major preflight and block launch; retried
        // once Slick ships a matching Electron.
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
    // Offset from Slick's own updater check.
    setTimeout(run, 90_000).unref?.();
  }

  return { applyStagedIfAny, checkNow, scheduleChecks, latestVersion, installedVersion };
}

const WIN_LATEST_REDIRECT = 'https://slack.com/ssb/download-win64';
const WIN_VERSION_RE = /desktop-releases\/windows\/x64\/(\d+\.\d+\.\d+)\//;
const WIN_FEED = (version: string) => `https://downloads.slack-edge.com/desktop-releases/windows/x64/${version}/`;
/** Update.exe downloads and unpacks ~160MB. */
const WIN_UPDATE_TIMEOUT_MS = 30 * 60 * 1000;

function createWindowsSlackUpdater(ua: string): SlackUpdater {
  const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'slack');
  const updateExe = path.join(base, 'Update.exe');

  const installedVersion = () => {
    try {
      return (
        fs
          .readdirSync(base)
          .filter((name) => /^app-\d+\.\d+\.\d+$/.test(name))
          .map((name) => name.slice(4))
          .toSorted((a, b) => cmpVersion(b, a))[0] ?? ''
      );
    } catch {
      return '';
    }
  };

  function latestVersion(): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.get(WIN_LATEST_REDIRECT, { headers: { 'User-Agent': ua } }, (res) => {
        res.resume();
        const match = WIN_VERSION_RE.exec(res.headers.location || '');
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && match) resolve(match[1]);
        else reject(new Error(`unexpected latest-version response HTTP ${status}`));
      });
      req.setTimeout(15000, () => req.destroy(new Error('latest-version check timed out')));
      req.on('error', reject);
    });
  }

  let checking = false;

  async function checkNow(): Promise<void> {
    if (checking) return;
    // Only a standalone (non-Store) install has Update.exe.
    if (!fs.existsSync(updateExe)) return;
    checking = true;
    try {
      const installed = installedVersion();
      if (!installed) return;
      let latest: string;
      try {
        latest = await latestVersion();
      } catch (error) {
        log(`latest-version check failed: ${reason(error)}`);
        return;
      }
      if (cmpVersion(latest, installed) <= 0) return;

      log(`Slack ${latest} available (installed ${installed}); updating through Squirrel`);
      await new Promise<void>((resolve) =>
        execFile(
          updateExe,
          ['--update', WIN_FEED(latest)],
          { windowsHide: true, timeout: WIN_UPDATE_TIMEOUT_MS },
          (error) => {
            if (error) log(`Squirrel update failed: ${reason(error)}`);
            else log(`installed Slack ${installedVersion()}; takes effect on the next launch`);
            resolve();
          },
        ),
      );
    } finally {
      checking = false;
    }
  }

  function scheduleChecks(): void {
    const run = () => {
      checkNow().catch(() => {});
      setTimeout(run, CHECK_INTERVAL_MS).unref?.();
    };
    setTimeout(run, 90_000).unref?.();
  }

  return { applyStagedIfAny: () => {}, checkNow, scheduleChecks, latestVersion, installedVersion };
}
