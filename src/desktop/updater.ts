// Slick self-updater. A download is installed only after attestation.ts has
// verified its build provenance.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron';
import { stageAppImage, swapAppImage } from './appImageUpdate.js';
import { AttestationError, sha256File, verifyBundle } from './attestation.js';
import { settingsDir } from './paths.js';

const PLATFORM = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux';
const MAC = PLATFORM === 'darwin';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REPO = '3kh0/slick';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;

type Asset = { name?: string; browser_download_url?: string };
type Release = { tag_name?: string; html_url?: string; assets?: Asset[] };
type State = { lastCheckedAt?: number; lastPromptedBuild?: number; lastPromptedAt?: number };
type Progress = {
  title?: string;
  status?: string;
  percent?: number;
  pctText?: string;
  detail?: string;
  indeterminate?: boolean;
};

function fmtBytes(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function fmtEta(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '--';
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Releases are tagged `v<build>`; anything else is not an update we can compare. */
function releaseBuild(release: Release | null): number {
  const match = /^v([1-9]\d*)$/.exec(String(release?.tag_name ?? '').trim());
  return match ? Number.parseInt(match[1], 10) : 0;
}

/** The directory an update replaces: the .app bundle, or the unpacked app dir. */
function installRoot(): string {
  return MAC ? path.resolve(process.execPath, '..', '..', '..') : path.dirname(process.execPath);
}

/**
 * Why Slick cannot replace itself here, or '' when it can. Flatpak's /app is
 * read-only, and an unwritable install dir would fail the swap after download.
 */
function selfUpdateBlocker(): string {
  if (PLATFORM === 'linux') {
    if (process.env.FLATPAK_ID || fs.existsSync('/.flatpak-info')) {
      return 'This copy of Slick is a Flatpak, so it is updated through Flatpak.';
    }
    if (installRoot() === '/opt/Slick') {
      return 'This copy of Slick is a system package. Update it with your package manager or download a new package from the release page.';
    }
    if (process.env.APPIMAGE) {
      try {
        fs.accessSync(path.dirname(process.env.APPIMAGE), fs.constants.W_OK);
        fs.accessSync(process.env.APPIMAGE, fs.constants.W_OK);
        return '';
      } catch {
        return `Slick cannot replace ${process.env.APPIMAGE}. Move the AppImage to a writable directory to enable self-updates.`;
      }
    }
  }
  try {
    fs.accessSync(path.dirname(installRoot()), fs.constants.W_OK);
    fs.accessSync(installRoot(), fs.constants.W_OK);
    return '';
  } catch {
    return `Slick cannot write to ${installRoot()}, so it cannot update itself there.`;
  }
}

/** PowerShell single-quoted literal. */
function psq(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function progressHtml(): string {
  const common =
    '*{box-sizing:border-box}' +
    'body{display:flex;flex-direction:column;justify-content:center;padding:26px 30px}' +
    '.head{margin-bottom:18px}' +
    '#title{font-size:15px;font-weight:600}' +
    '#status{margin-top:3px;font-size:12px;color:var(--muted)}' +
    '.track{position:relative;height:4px;border-radius:99px;background:var(--track);overflow:hidden}' +
    '#bar{height:100%;width:0%;border-radius:99px;background:var(--accent);transition:width .2s ease}' +
    '#bar.indet{position:absolute;left:0;width:35%;animation:slide 1.05s ease-in-out infinite;transition:none}' +
    '@keyframes slide{0%{left:-35%}100%{left:100%}}' +
    '.foot{display:flex;justify-content:space-between;gap:12px;margin-top:11px;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}';
  const theme = MAC
    ? ':root{color-scheme:light dark;--bg:#ececec;--fg:#1d1d1f;--muted:rgba(60,60,67,.6);--track:rgba(60,60,67,.13);--accent:#007aff}' +
      '@media (prefers-color-scheme:dark){:root{--bg:#1e1e1e;--fg:#f5f5f7;--muted:rgba(235,235,245,.6);--track:rgba(235,235,245,.15);--accent:#0a84ff}}' +
      'html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;background:var(--bg);color:var(--fg);-webkit-user-select:none;cursor:default}' +
      '.head{-webkit-app-region:drag}' +
      '#title{letter-spacing:-.01em}'
    : ':root{color-scheme:light dark;--bg:#f3f3f3;--fg:#1a1a1a;--muted:#5f5f5f;--track:rgba(0,0,0,.1);--accent:#0078d4}' +
      '@media (prefers-color-scheme:dark){:root{--bg:#202020;--fg:#fafafa;--muted:#a0a0a0;--track:rgba(255,255,255,.12);--accent:#4cc2ff}}' +
      'html,body{margin:0;height:100%;font-family:"Segoe UI Variable Text","Segoe UI",sans-serif;background:var(--bg);color:var(--fg);user-select:none;cursor:default}';
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>${theme}${common}</style></head><body>` +
    '<div class="head"><div id="title">Updating Slick</div><div id="status">Starting download…</div></div>' +
    '<div class="track"><div id="bar"></div></div>' +
    '<div class="foot"><span id="detail"></span><span id="pct"></span></div>' +
    '<script>window.__update=function(p){' +
    'var bar=document.getElementById("bar");' +
    'if(p.indeterminate){bar.classList.add("indet");bar.style.width="";}' +
    'else{bar.classList.remove("indet");bar.style.width=(p.percent||0)+"%";}' +
    'document.getElementById("title").textContent=p.title||"Updating Slick";' +
    'document.getElementById("status").textContent=p.status||"";' +
    'document.getElementById("detail").textContent=p.detail||"";' +
    'document.getElementById("pct").textContent=p.pctText||"";' +
    '};</script>' +
    '</body></html>'
  );
}

export type UpdateResult =
  | { state: 'unsupported'; message: string }
  | { state: 'error'; message: string }
  | { state: 'latest'; message: string }
  | { state: 'available'; latestBuild: number; message: string };

export type Updater = ReturnType<typeof createUpdater>;

export function createUpdater({ version, build }: { version: string; build: number }) {
  const ua = `Slick/${version}`;

  const statePath = () => path.join(settingsDir(), 'update-check.json');

  function readState(): State {
    try {
      return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    } catch {
      return {};
    }
  }

  function writeState(state: State): void {
    try {
      const file = statePath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
    } catch {}
  }

  function fetchJson(
    url: string,
    opts: { maxBytes?: number; timeout?: number; notFoundMessage?: string } = {},
  ): Promise<any> {
    const maxBytes = opts.maxBytes ?? 1024 * 1024;
    const timeout = opts.timeout ?? 15000;
    return new Promise((resolve, reject) => {
      const req = https.get(
        url,
        { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `${ua} Build ${build}` } },
        (res) => {
          if (res.statusCode === 404 && opts.notFoundMessage) {
            res.resume();
            reject(new AttestationError(opts.notFoundMessage));
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`GitHub API returned HTTP ${res.statusCode}`));
            return;
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
            if (body.length > maxBytes) req.destroy(new Error('GitHub API response was too large'));
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.setTimeout(timeout, () => req.destroy(new Error('GitHub API request timed out')));
      req.on('error', reject);
    });
  }

  const fetchLatestRelease = (): Promise<Release> => fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);

  /** Resolves to the verified digest, or throws an AttestationError. */
  async function verifyReleaseArtifact(file: string): Promise<string> {
    const digest = await sha256File(file);
    const data = await fetchJson(`https://api.github.com/repos/${REPO}/attestations/sha256:${digest}`, {
      maxBytes: 4 * 1024 * 1024,
      timeout: 30000,
      notFoundMessage: 'no build provenance attestation found for this download',
    });
    const attestations = data?.attestations ?? [];
    if (!attestations.length) {
      throw new AttestationError('no build provenance attestation found for this download');
    }
    let lastError: unknown = null;
    for (const attestation of attestations) {
      try {
        verifyBundle(attestation.bundle, digest);
        return digest;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new AttestationError('build provenance verification failed');
  }

  function pickAsset(release: Release): Asset | null {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const suffix =
      PLATFORM === 'darwin'
        ? `-mac-${arch}.zip`
        : PLATFORM === 'win32'
          ? `-win32-${arch}.zip`
          : process.env.APPIMAGE
            ? '-linux-x86_64.AppImage'
            : `-linux-${arch}.tar.gz`;
    return (release.assets ?? []).find((a) => typeof a?.name === 'string' && a.name.endsWith(suffix)) ?? null;
  }

  function download(url: string, dest: string, onProgress: (received: number, total: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const get = (u: string, redirects: number) => {
        https
          .get(u, { headers: { 'User-Agent': ua } }, (res) => {
            const status = res.statusCode ?? 0;
            if (status > 300 && status < 400 && res.headers.location) {
              res.resume();
              if (redirects > 5) {
                reject(new Error('too many redirects'));
                return;
              }
              get(res.headers.location, redirects + 1);
              return;
            }
            if (status !== 200) {
              res.resume();
              reject(new Error(`download returned HTTP ${status}`));
              return;
            }
            const total = Number.parseInt(String(res.headers['content-length'] ?? '0'), 10);
            let received = 0;
            const file = fs.createWriteStream(dest);
            res.on('data', (chunk) => {
              received += chunk.length;
              onProgress(received, total);
            });
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

  function extract(archive: string, dir: string): Promise<void> {
    const [cmd, args]: [string, string[]] =
      PLATFORM === 'darwin'
        ? ['/usr/bin/ditto', ['-x', '-k', archive, dir]]
        : PLATFORM === 'linux'
          ? ['/usr/bin/tar', ['-xzf', archive, '-C', dir]]
          : [
              'powershell.exe',
              [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `Expand-Archive -LiteralPath ${psq(archive)} -DestinationPath ${psq(dir)} -Force`,
              ],
            ];
    return new Promise((resolve, reject) => {
      execFile(cmd, args, (error) => (error ? reject(error) : resolve()));
    });
  }

  /**
   * The app root inside an extracted archive: the bundle on macOS, the
   * executable's dir elsewhere, at the top level or one down. electron-builder's
   * layout isn't fixed across platforms/versions, so it is searched for.
   */
  function findStage(dir: string): string | null {
    const isRoot = (candidate: string): boolean => {
      if (MAC) return candidate.endsWith('.app') && fs.existsSync(path.join(candidate, 'Contents', 'MacOS'));
      return fs.existsSync(path.join(candidate, PLATFORM === 'win32' ? 'Slick.exe' : 'slick'));
    };

    if (!MAC && isRoot(dir)) return dir;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return null;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      try {
        if (fs.statSync(full).isDirectory() && isRoot(full)) return full;
      } catch {}
    }
    return null;
  }

  /**
   * Hand the swap to a detached helper that waits for this process to exit.
   * `dir` is passed separately because `stage` can be the extraction dir
   * itself; deriving cleanup from it could delete a dir we don't own.
   */
  function install(stage: string, dir: string, relaunch = true): Promise<void> {
    const again = relaunch ? '1' : '';
    if (MAC) {
      const appPath = installRoot();
      const sh =
        'APP="$1"; STAGE="$2"; DIR="$3"; PID="$4"; while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done; ' +
        'rm -rf "$APP.old"; mv "$APP" "$APP.old" 2>/dev/null || true; ' +
        'if /usr/bin/ditto "$STAGE" "$APP"; then rm -rf "$APP.old"; else rm -rf "$APP"; mv "$APP.old" "$APP" 2>/dev/null || true; fi; ' +
        'rm -rf "$DIR"; [ -z "$5" ] || open "$APP"';
      spawn('/bin/sh', ['-c', sh, 'slick-updater', appPath, stage, dir, String(process.pid), again], {
        detached: true,
        stdio: 'ignore',
      }).unref();
      return Promise.resolve();
    }

    if (PLATFORM === 'linux' && process.env.APPIMAGE) {
      const image = process.env.APPIMAGE;
      swapAppImage(stage, image);
      fs.rmSync(dir, { recursive: true, force: true });
      if (relaunch) {
        const sh =
          'IMAGE="$1"; PID="$2"; while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done; exec "$IMAGE" >/dev/null 2>&1';
        spawn('/bin/sh', ['-c', sh, 'slick-updater', image, String(process.pid)], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      }
      return Promise.resolve();
    }

    if (PLATFORM === 'linux') {
      const appDir = path.dirname(process.execPath);
      const sh =
        'APP="$1"; STAGE="$2"; DIR="$3"; PID="$4"; while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done; ' +
        'rm -rf "$APP.old"; mv "$APP" "$APP.old" 2>/dev/null || true; ' +
        'if mv "$STAGE" "$APP"; then rm -rf "$APP.old"; else rm -rf "$APP"; mv "$APP.old" "$APP" 2>/dev/null || true; fi; ' +
        'rm -rf "$DIR"; [ -z "$5" ] || "$APP/slick" >/dev/null 2>&1 &';
      spawn('/bin/sh', ['-c', sh, 'slick-updater', appDir, stage, dir, String(process.pid), again], {
        detached: true,
        stdio: 'ignore',
      }).unref();
      return Promise.resolve();
    }

    const appDir = path.dirname(process.execPath);
    const ps1 = path.join(dir, 'slick-update.ps1');
    const lines = [
      'param([int]$ProcId,[string]$App,[string]$Stage,[string]$Dir,[int]$Relaunch)',
      '$ErrorActionPreference = "SilentlyContinue"',
      'while (Get-Process -Id $ProcId -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }',
      '$deadline = (Get-Date).AddSeconds(20)',
      'while ((Get-Process Slick -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$App\\*" }) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }',
      'Start-Sleep -Milliseconds 500',
      'robocopy $Stage $App /MIR /R:10 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null',
      '$env:ELECTRON_NO_ATTACH_CONSOLE = "1"',
      'if ($Relaunch) { Start-Process -FilePath (Join-Path $App "Slick.exe") -WorkingDirectory $App }',
      'Remove-Item -Recurse -Force $Dir',
    ];
    fs.writeFileSync(ps1, lines.join('\r\n'));

    // libuv puts every Windows child into a kill-on-close job, so a helper
    // spawned directly dies with Slick and the update never installs.
    // `detached` doesn't help (powershell.exe never runs as DETACHED_PROCESS),
    // but grandchildren may break away, so a throwaway launcher starts the
    // real helper via Start-Process. The paths are ours and contain no `"`.
    const helperArgs = [
      '-NoProfile -ExecutionPolicy Bypass',
      `-File "${ps1}"`,
      `-ProcId ${process.pid}`,
      `-App "${appDir}"`,
      `-Stage "${stage}"`,
      `-Dir "${dir}"`,
      `-Relaunch ${relaunch ? 1 : 0}`,
    ].join(' ');
    const launcher = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Start-Process powershell.exe -WindowStyle Hidden -ArgumentList ${psq(helperArgs)}`,
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    // The launcher is still in the job, so don't exit until it has handed off.
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 10_000);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      launcher.once('exit', done);
      launcher.once('error', done);
    });
  }

  let progressWin: BrowserWindow | null = null;
  let progressData: Progress | null = null;

  /** Slack's own windows carry the taskbar/dock progress; -1 clears it. */
  function setTaskbarProgress(fraction: number): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed() || win === progressWin) continue;
      try {
        win.setProgressBar(fraction);
      } catch {}
    }
  }

  function flushProgress(): void {
    if (!progressWin || progressWin.isDestroyed() || !progressData) return;
    progressWin.webContents
      .executeJavaScript(`window.__update && window.__update(${JSON.stringify(progressData)})`)
      .catch(() => {});
  }

  function setProgress(data: Progress): void {
    progressData = data;
    flushProgress();
  }

  function createProgressWindow(): BrowserWindow {
    if (progressWin && !progressWin.isDestroyed()) return progressWin;
    const opts: Electron.BrowserWindowConstructorOptions = {
      width: 400,
      height: 158,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'Updating Slick',
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    };
    if (MAC) {
      Object.assign(opts, {
        titleBarStyle: 'hiddenInset',
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ececec',
      });
    } else {
      Object.assign(opts, {
        autoHideMenuBar: true,
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3',
      });
    }
    const win = new BrowserWindow(opts);
    progressWin = win;
    try {
      if (MAC) win.setMenu(null);
      else win.setMenuBarVisibility(false);
    } catch {}
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(progressHtml())}`);
    win.webContents.on('did-finish-load', flushProgress);
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show();
    });
    win.on('closed', () => {
      progressWin = null;
    });
    return win;
  }

  function closeProgressWindow(): void {
    progressData = null;
    if (progressWin && !progressWin.isDestroyed()) progressWin.close();
    progressWin = null;
  }

  async function perform(release: Release): Promise<void> {
    const asset = pickAsset(release);
    if (!asset?.browser_download_url || selfUpdateBlocker()) {
      await shell.openExternal(release.html_url || RELEASES_URL);
      return;
    }
    const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'slick-update-'));
    const archive = path.join(dir, asset.name ?? 'slick-update');
    const status = `Slick Build ${releaseBuild(release)}`;
    let stage: string;

    try {
      setTaskbarProgress(0);
      createProgressWindow();
      setProgress({ title: 'Downloading update', status, percent: 0, pctText: '0%', detail: 'Starting…' });

      let lastTime = Date.now();
      let lastReceived = 0;
      let speed = 0;
      await download(asset.browser_download_url, archive, (received, total) => {
        const now = Date.now();
        const dt = (now - lastTime) / 1000;
        if (dt >= 0.25) {
          const instant = (received - lastReceived) / dt;
          speed = speed ? speed * 0.6 + instant * 0.4 : instant;
          lastTime = now;
          lastReceived = received;
        }
        const fraction = total ? received / total : 0;
        const pct = Math.round(fraction * 100);
        const rate = `${fmtBytes(speed)}/s`;
        setTaskbarProgress(fraction * 0.85);
        setProgress(
          total
            ? {
                title: 'Downloading update',
                status,
                percent: pct,
                pctText: `${pct}%`,
                detail: `${fmtBytes(received)} / ${fmtBytes(total)}  ·  ${rate}  ·  ${fmtEta((total - received) / speed)} left`,
              }
            : {
                title: 'Downloading update',
                status,
                indeterminate: true,
                pctText: '',
                detail: `${fmtBytes(received)} downloaded  ·  ${rate}`,
              },
        );
      });

      setTaskbarProgress(0.9);
      setProgress({
        title: 'Verifying update',
        status,
        indeterminate: true,
        pctText: '',
        detail: 'Checking build provenance…',
      });
      await verifyReleaseArtifact(archive);

      setTaskbarProgress(0.95);
      if (PLATFORM === 'linux' && process.env.APPIMAGE) {
        setProgress({
          title: 'Installing update',
          status,
          indeterminate: true,
          pctText: '',
          detail: 'Staging AppImage…',
        });
        stage = stageAppImage(archive, process.env.APPIMAGE);
      } else {
        setProgress({ title: 'Installing update', status, indeterminate: true, pctText: '', detail: 'Extracting…' });
        await extract(archive, dir);
        const found = findStage(dir);
        if (!found) throw new Error('the update archive did not contain a Slick application');
        stage = found;
      }

      setTaskbarProgress(1);
      setProgress({ title: 'Update ready', status, percent: 100, pctText: '100%', detail: 'Ready to restart.' });
    } catch (error) {
      setTaskbarProgress(-1);
      closeProgressWindow();
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
      const blocked = error instanceof AttestationError;
      const reason = String((error as Error)?.message ?? error);
      const { response } = await dialog.showMessageBox({
        type: 'error',
        title: blocked ? 'Slick update blocked' : 'Slick update failed',
        message: blocked ? 'Build provenance verification failed' : 'Could not download the update',
        detail: blocked
          ? `${reason}. The download may have been tampered with, so Slick refused to install it. You can download it manually from the release page if you want to inspect it.`
          : `${reason}. You can download it manually instead.`,
        buttons: ['Open Release Page', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) await shell.openExternal(release.html_url || RELEASES_URL);
      return;
    }

    setTaskbarProgress(-1);
    closeProgressWindow();
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Slick update ready',
      message: `Slick Build ${releaseBuild(release)} is ready to install`,
      detail: 'Slick will restart to finish updating.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      await install(stage, dir);
      app.quit();
      return;
    }
    // "Later": install on next quit without relaunching. Hold the quit until
    // the helper is launched, then exit(), since other will-quit listeners
    // have already run.
    app.once('will-quit', (event) => {
      event.preventDefault();
      void install(stage, dir, false).finally(() => app.exit(0));
    });
  }

  async function promptDownload(release: Release, latestBuild: number): Promise<void> {
    const blocker = selfUpdateBlocker();
    try {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Slick update available',
        message: `Slick Build ${latestBuild} is available`,
        detail: blocker
          ? `You are running Build ${build}. ${blocker}`
          : `You are running Build ${build}. Download it now and Slick will install it on the next restart.`,
        buttons: [blocker ? 'Open Release Page' : 'Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) await perform(release);
    } catch {}
  }

  /** The background check: silent unless there is something to offer. */
  async function checkForUpdates(): Promise<void> {
    // Stay quiet where the answer could only be "update it yourself"; the menu
    // item still reports availability.
    if (!build || selfUpdateBlocker()) return;
    const now = Date.now();
    const state = readState();
    if (state.lastCheckedAt && now - state.lastCheckedAt < CHECK_INTERVAL_MS) return;
    writeState({ ...state, lastCheckedAt: now });

    let release: Release;
    try {
      release = await fetchLatestRelease();
    } catch {
      return;
    }

    const latestBuild = releaseBuild(release);
    if (latestBuild <= build) return;

    const promptState = readState();
    if (promptState.lastPromptedBuild === latestBuild && now - (promptState.lastPromptedAt ?? 0) < CHECK_INTERVAL_MS) {
      return;
    }
    writeState({ ...promptState, lastPromptedBuild: latestBuild, lastPromptedAt: Date.now() });
    await promptDownload(release, latestBuild);
  }

  /** The menu item: always says something, even when there is no update. */
  async function manualCheckForUpdates({ quiet = false } = {}): Promise<UpdateResult> {
    const say = (options: Electron.MessageBoxOptions) => {
      if (!quiet) dialog.showMessageBox(options).catch(() => {});
    };

    if (!build) {
      const message = 'This is a development build, so Slick cannot check for updates.';
      say({
        type: 'info',
        title: 'Slick updates',
        message: 'Update checking is unavailable',
        detail: message,
        buttons: ['OK'],
      });
      return { state: 'unsupported', message };
    }

    let release: Release;
    try {
      writeState({ ...readState(), lastCheckedAt: Date.now() });
      release = await fetchLatestRelease();
    } catch (error) {
      const reason = String((error as Error)?.message ?? error);
      say({
        type: 'error',
        title: 'Slick update check failed',
        message: 'Could not check for updates',
        detail: `${reason}. Try again later.`,
        buttons: ['OK'],
      });
      return { state: 'error', message: `Could not check for updates: ${reason}` };
    }

    const latestBuild = releaseBuild(release);
    if (latestBuild <= build) {
      say({
        type: 'info',
        title: 'Slick is up to date',
        message: "You're running the latest version of Slick",
        detail: `Build ${build} is the newest available.`,
        buttons: ['OK'],
      });
      return { state: 'latest', message: `Slick is up to date. Build ${build} is the newest available.` };
    }

    writeState({ ...readState(), lastPromptedBuild: latestBuild, lastPromptedAt: Date.now() });
    void promptDownload(release, latestBuild);
    return { state: 'available', latestBuild, message: `Build ${latestBuild} is available.` };
  }

  function scheduleUpdateChecks(): void {
    if (!build) return;
    const run = () => {
      void checkForUpdates();
      setTimeout(run, CHECK_INTERVAL_MS);
    };
    app
      .whenReady()
      .then(() => {
        // Delay the first check so it doesn't compete with Slack's boot.
        const state = readState();
        const elapsed = Date.now() - (state.lastCheckedAt ?? 0);
        const delay = state.lastCheckedAt ? Math.max(30_000, CHECK_INTERVAL_MS - elapsed) : 30_000;
        setTimeout(run, delay);
      })
      .catch(() => {});
  }

  const info = () => ({ version, build, lastCheckedAt: readState().lastCheckedAt ?? 0 });

  return { RELEASES_URL, readState, info, scheduleUpdateChecks, manualCheckForUpdates };
}
