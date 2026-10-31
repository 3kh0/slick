// Slick self-updater. A download is installed only after attestation.ts has
// verified its build provenance.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { stageAppImage, swapAppImage } from './appImageUpdate.js';
import { AttestationError, sha256File, verifyBundle } from './attestation.js';
import { createProxyAgent } from './proxyAgent.js';
import { parseDownloadProxy } from '../shared/downloadProxy.ts';
import { broadcast } from './bridge.js';
import type { UpdateStatus } from '../app/updateStatus.ts';
import { settingsDir } from './paths.js';

const PLATFORM = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux';
const MAC = PLATFORM === 'darwin';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STREAMS = 16;
const CHUNK_BYTES = 2 * 1024 * 1024;
const CHUNK_RETRIES = 3;
const MAX_REDIRECTS = 5;
const STALL_MS = 20_000;
const REPO = '3kh0/slick';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;

type Asset = { name?: string; browser_download_url?: string };
type Release = { tag_name?: string; html_url?: string; assets?: Asset[] };
type State = { lastCheckedAt?: number };
type Progress = {
  title?: string;
  percent?: number;
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
    if (process.execPath.startsWith('/nix/store/')) {
      return 'This copy of Slick comes from Nix, so it is updated through Nix.';
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

export type UpdateResult =
  | { state: 'unsupported'; message: string }
  | { state: 'error'; message: string }
  | { state: 'latest'; message: string }
  | { state: 'available'; latestBuild: number; message: string };

export type Updater = ReturnType<typeof createUpdater>;

export function createUpdater({
  version,
  build,
  downloadProxy = () => '',
}: {
  version: string;
  build: number;
  /** The proxy URL from settings, read per download so a change applies without a restart. */
  downloadProxy?: () => string;
}) {
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
            ? process.arch === 'arm64'
              ? '-linux-aarch64.AppImage'
              : '-linux-x86_64.AppImage'
            : `-linux-${arch}.tar.gz`;
    return (release.assets ?? []).find((a) => typeof a?.name === 'string' && a.name.endsWith(suffix)) ?? null;
  }

  /** GET `url`, following redirects; resolves the final response and the URL it came from. */
  function open(
    url: string,
    headers: Record<string, string> = {},
    redirects = 0,
    agent?: https.Agent,
  ): Promise<{ res: IncomingMessage; url: string }> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': ua, ...headers }, agent }, (res) => {
        const status = res.statusCode ?? 0;
        if (status > 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) {
            reject(new Error('too many redirects'));
            return;
          }
          open(new URL(res.headers.location, url).href, headers, redirects + 1, agent).then(resolve, reject);
          return;
        }
        resolve({ res, url });
      });
      req.setTimeout(STALL_MS, () => req.destroy(new Error('download stalled')));
      req.on('error', reject);
    });
  }

  /** Single stream: the fallback for servers that ignore Range. */
  function saveStream(
    res: IncomingMessage,
    dest: string,
    onProgress: (received: number, total: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`download returned HTTP ${res.statusCode}`));
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
    });
  }

  /** Write a 206 body at `start`; throws if it ends short or the connection drops. */
  async function pump(
    res: IncomingMessage,
    file: fs.promises.FileHandle,
    start: number,
    end: number,
    count: (bytes: number) => void,
  ): Promise<void> {
    if (res.statusCode !== 206) {
      res.resume();
      throw new Error(`download returned HTTP ${res.statusCode}`);
    }
    let pos = start;
    for await (const chunk of res as AsyncIterable<Buffer>) {
      await file.write(chunk, 0, chunk.length, pos);
      pos += chunk.length;
      count(chunk.length);
    }
    if (pos !== end + 1) throw new Error('download ended early');
  }

  /**
   * GitHub's release CDN can throttle each connection far below the link speed,
   * so the file is fetched as Range chunks over a few connections, each chunk
   * retried on its own. The first request doubles as the Range probe: a 200 means
   * the server ignores Range and that response is just streamed to disk.
   */
  async function download(
    url: string,
    dest: string,
    onProgress: (received: number, total: number) => void,
  ): Promise<void> {
    // A bad proxy setting fails the update rather than quietly going direct.
    const proxy = parseDownloadProxy(downloadProxy());
    const agent = proxy ? createProxyAgent(proxy) : undefined;
    try {
      await fetchAll(url, dest, onProgress, agent);
    } finally {
      agent?.destroy();
    }
  }

  async function fetchAll(
    url: string,
    dest: string,
    onProgress: (received: number, total: number) => void,
    agent?: https.Agent,
  ): Promise<void> {
    const first = await open(url, { Range: `bytes=0-${CHUNK_BYTES - 1}` }, 0, agent);
    const total = Number(/^bytes \d+-\d+\/(\d+)$/.exec(String(first.res.headers['content-range'] ?? ''))?.[1]);
    if (first.res.statusCode !== 206 || !Number.isSafeInteger(total) || total <= 0) {
      return saveStream(first.res, dest, onProgress);
    }

    const file = await fs.promises.open(dest, 'w');
    try {
      let received = 0;
      const count = (bytes: number) => onProgress((received += bytes), total);
      const chunks = Math.ceil(total / CHUNK_BYTES);
      let next = 1;
      let failure: unknown = null;
      const failed = () => failure !== null;

      // Retries go back through the original URL in case the signed CDN link expired.
      const fetchChunk = async (index: number, res?: IncomingMessage): Promise<void> => {
        const start = index * CHUNK_BYTES;
        const end = Math.min(start + CHUNK_BYTES, total) - 1;
        for (let attempt = 0; ; attempt++) {
          let got = 0;
          try {
            const body =
              res ?? (await open(attempt ? url : first.url, { Range: `bytes=${start}-${end}` }, 0, agent)).res;
            await pump(body, file, start, end, (bytes) => {
              got += bytes;
              count(bytes);
            });
            return;
          } catch (error) {
            count(-got);
            res = undefined;
            if (attempt >= CHUNK_RETRIES) {
              failure ??= error;
              throw error;
            }
          }
        }
      };
      const worker = async () => {
        for (let index = next++; index < chunks && !failed(); index = next++) await fetchChunk(index);
      };

      await Promise.allSettled([
        fetchChunk(0, first.res).then(worker),
        ...Array.from({ length: Math.min(STREAMS, chunks) - 1 }, worker),
      ]);
      if (failure) throw failure;
    } finally {
      await file.close();
    }
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
        'rm -rf "$DIR"; [ -z "$5" ] || "$APP/slick" --no-sandbox >/dev/null 2>&1 &';
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

  let status: UpdateStatus = { state: 'idle' };
  let availableRelease: Release | null = null;
  let pendingInstall: { stage: string; dir: string } | null = null;
  let busy = false;

  function publish(next: UpdateStatus): void {
    status = next;
    broadcast('slick:update-status', status);
  }

  /** Slack's own windows carry the taskbar/dock progress; -1 clears it. */
  function setTaskbarProgress(fraction: number): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.setProgressBar(fraction);
      } catch {}
    }
  }

  function setProgress(data: Progress): void {
    publish({
      state: 'downloading',
      latestBuild: releaseBuild(availableRelease),
      title: data.title,
      detail: data.detail,
      percent: data.indeterminate ? undefined : data.percent,
    });
  }

  // Apply quietly on normal quit, or relaunch only after an explicit click.
  let relaunch = false;
  app.on('will-quit', (event) => {
    if (!pendingInstall) return;
    event.preventDefault();
    const { stage, dir } = pendingInstall;
    pendingInstall = null;
    void install(stage, dir, relaunch).finally(() => app.exit(0));
  });

  async function perform(release: Release): Promise<void> {
    const asset = pickAsset(release);
    if (!asset?.browser_download_url || selfUpdateBlocker()) {
      await shell.openExternal(release.html_url || RELEASES_URL);
      return;
    }
    let dir = '';
    let stage: string;
    try {
      dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'slick-update-'));
      const archive = path.join(dir, asset.name ?? 'slick-update');
      setTaskbarProgress(0);
      setProgress({ title: 'Downloading update', percent: 0, detail: 'Starting…' });

      let lastTime = Date.now();
      let lastReceived = 0;
      let speed = 0;
      let lastProgressAt = 0;
      await download(asset.browser_download_url, archive, (received, total) => {
        const now = Date.now();
        const dt = (now - lastTime) / 1000;
        if (dt >= 0.25) {
          const instant = (received - lastReceived) / dt;
          speed = speed ? speed * 0.6 + instant * 0.4 : instant;
          lastTime = now;
          lastReceived = received;
        }
        if (now - lastProgressAt < 250 && (!total || received < total)) return;
        lastProgressAt = now;
        const fraction = total ? received / total : 0;
        const pct = Math.round(fraction * 100);
        const rate = `${fmtBytes(speed)}/s`;
        setTaskbarProgress(fraction * 0.85);
        setProgress(
          total
            ? {
                title: 'Downloading update',
                percent: pct,
                detail: `${fmtBytes(received)} / ${fmtBytes(total)}  ·  ${rate}  ·  ${fmtEta((total - received) / speed)} left`,
              }
            : {
                title: 'Downloading update',
                indeterminate: true,
                detail: `${fmtBytes(received)} downloaded  ·  ${rate}`,
              },
        );
      });

      setTaskbarProgress(0.9);
      setProgress({
        title: 'Verifying update',
        indeterminate: true,
        detail: 'Checking build provenance…',
      });
      await verifyReleaseArtifact(archive);

      setTaskbarProgress(0.95);
      if (PLATFORM === 'linux' && process.env.APPIMAGE) {
        setProgress({
          title: 'Preparing update',
          indeterminate: true,
          detail: 'Staging AppImage…',
        });
        stage = stageAppImage(archive, process.env.APPIMAGE);
      } else {
        setProgress({ title: 'Preparing update', indeterminate: true, detail: 'Extracting…' });
        await extract(archive, dir);
        const found = findStage(dir);
        if (!found) throw new Error('the update archive did not contain a Slick application');
        stage = found;
      }

      setTaskbarProgress(1);
      setProgress({ title: 'Update ready', percent: 100, detail: 'Ready to restart.' });
    } catch (error) {
      setTaskbarProgress(-1);
      try {
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
      const blocked = error instanceof AttestationError;
      const reason = String((error as Error)?.message ?? error);
      publish({
        state: 'error',
        latestBuild: releaseBuild(release),
        detail: blocked
          ? `Build provenance verification failed: ${reason}. Slick refused to install this download.`
          : reason,
      });
      return;
    }

    pendingInstall = { stage, dir };
    setTaskbarProgress(-1);
    publish({ state: 'ready', latestBuild: releaseBuild(release) });
  }

  function offer(release: Release): void {
    availableRelease = release;
    publish({ state: 'available', latestBuild: releaseBuild(release), detail: selfUpdateBlocker() || undefined });
  }

  async function activate(): Promise<void> {
    if (busy) return;
    if (pendingInstall) {
      relaunch = true;
      app.quit();
      return;
    }
    if (!availableRelease) return;
    busy = true;
    try {
      await perform(availableRelease);
    } finally {
      busy = false;
    }
  }

  /** The background check: silent unless there is something to offer. */
  async function checkForUpdates(): Promise<void> {
    if (!build || busy || pendingInstall || availableRelease) return;
    const now = Date.now();
    const state = readState();
    writeState({ ...state, lastCheckedAt: now });

    let release: Release;
    try {
      release = await fetchLatestRelease();
    } catch {
      return;
    }

    const latestBuild = releaseBuild(release);
    if (latestBuild <= build) return;

    offer(release);
  }

  /** The menu item: always says something, even when there is no update. */
  async function manualCheckForUpdates({ quiet = false } = {}): Promise<UpdateResult> {
    if (busy || pendingInstall)
      return {
        state: 'available',
        latestBuild: status.latestBuild ?? build,
        message: 'An update is already downloading or ready to apply!',
      };
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

    if (!busy && !pendingInstall) offer(release);
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
        setTimeout(run, 30_000);
      })
      .catch(() => {});
  }

  const info = () => ({ version, build, lastCheckedAt: readState().lastCheckedAt ?? 0 });

  return {
    RELEASES_URL,
    readState,
    info,
    scheduleUpdateChecks,
    manualCheckForUpdates,
    getStatus: () => status,
    activate,
  };
}
