'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile, spawn } = require('child_process');
const { app, dialog, shell, BrowserWindow } = require('electron');

const MAC = process.platform === 'darwin';
const CINT = 6 * 60 * 60 * 1000;

function fmtBytes(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return '--';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return (i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
}

function fmtEta(sec) {
  if (!isFinite(sec) || sec < 0) return '--';
  const s = Math.round(sec);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

function releaseBuild(release) {
  const match = /^v([1-9]\d*)$/.exec(String((release && release.tag_name) || '').trim());
  return match ? parseInt(match[1], 10) : 0;
}

function psq(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function progressHtml() {
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
    ? ':root{color-scheme:light dark;--fg:#1d1d1f;--muted:rgba(60,60,67,.6);--track:rgba(60,60,67,.13);--accent:#007aff}' +
      '@media (prefers-color-scheme:dark){:root{--fg:#f5f5f7;--muted:rgba(235,235,245,.6);--track:rgba(235,235,245,.15);--accent:#0a84ff}}' +
      'html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;background:transparent;color:var(--fg);-webkit-user-select:none;cursor:default}' +
      '.head{-webkit-app-region:drag}' +
      '#title{letter-spacing:-.01em}'
    : ':root{color-scheme:light dark;--bg:#f3f3f3;--fg:#1a1a1a;--muted:#5f5f5f;--track:rgba(0,0,0,.1);--accent:#0078d4}' +
      '@media (prefers-color-scheme:dark){:root{--bg:#202020;--fg:#fafafa;--muted:#a0a0a0;--track:rgba(255,255,255,.12);--accent:#4cc2ff}}' +
      'html,body{margin:0;height:100%;font-family:"Segoe UI Variable Text","Segoe UI",sans-serif;background:var(--bg);color:var(--fg);user-select:none;cursor:default}';
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    theme +
    common +
    '</style></head><body>' +
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

function create({ version, build, profile }) {
  const ua = 'Slick/' + version;

  function statePath() {
    return path.join(profile, 'slick', 'update-check.json');
  }
  function readState() {
    try {
      return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    } catch {
      return {};
    }
  }
  function writeState(state) {
    try {
      const file = statePath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
    } catch {}
  }

  function fetchLatestRelease() {
    return new Promise((resolve, reject) => {
      const req = https.get(
        'https://api.github.com/repos/3kh0/slick/releases/latest',
        { headers: { Accept: 'application/vnd.github+json', 'User-Agent': ua + ' Build ' + build } },
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

  function pickAsset(release) {
    const suffix = process.arch === 'arm64' ? '-arm64.zip' : '-x64.zip';
    return (
      ((release && release.assets) || []).find(
        (a) =>
          a &&
          typeof a.name === 'string' &&
          (MAC ? a.name.indexOf('win32') === -1 : a.name.indexOf('win32') !== -1) &&
          a.name.endsWith(suffix),
      ) || null
    );
  }

  function download(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
      const get = (u, redirects) => {
        https
          .get(u, { headers: { 'User-Agent': ua } }, (res) => {
            if (res.statusCode > 300 && res.statusCode < 400 && res.headers.location) {
              res.resume();
              if (redirects > 5) {
                reject(new Error('too many redirects'));
                return;
              }
              get(res.headers.location, redirects + 1);
              return;
            }
            if (res.statusCode !== 200) {
              res.resume();
              reject(new Error('download returned HTTP ' + res.statusCode));
              return;
            }
            const total = parseInt(res.headers['content-length'] || '0', 10);
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

  function extract(zip, dir) {
    const [cmd, args] = MAC
      ? ['/usr/bin/ditto', ['-x', '-k', zip, dir]]
      : [
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Expand-Archive -LiteralPath ' + psq(zip) + ' -DestinationPath ' + psq(dir) + ' -Force',
          ],
        ];
    return new Promise((resolve, reject) => {
      execFile(cmd, args, (e) => (e ? reject(e) : resolve()));
    });
  }

  function install(stage) {
    if (MAC) {
      const appPath = path.resolve(process.execPath, '..', '..', '..');
      const sh =
        'APP="$1"; STAGE="$2"; PID="$3"; while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done; rm -rf "$APP.old"; mv "$APP" "$APP.old" 2>/dev/null || true; if /usr/bin/ditto "$STAGE" "$APP"; then rm -rf "$APP.old"; else rm -rf "$APP"; mv "$APP.old" "$APP" 2>/dev/null || true; fi; rm -rf "$(dirname "$STAGE")"; open "$APP"';
      spawn('/bin/sh', ['-c', sh, 'slick-updater', appPath, stage, String(process.pid)], {
        detached: true,
        stdio: 'ignore',
      }).unref();
      return;
    }
    const appDir = path.dirname(process.execPath);
    const ps1 = path.join(path.dirname(stage), 'slick-update.ps1');
    const lines = [
      'param([int]$ProcId,[string]$App,[string]$Stage)',
      '$ErrorActionPreference = "SilentlyContinue"',
      'while (Get-Process -Id $ProcId -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }',
      'Start-Sleep -Milliseconds 500',
      'robocopy $Stage $App /MIR /NFL /NDL /NJH /NJS /NP | Out-Null',
      'Start-Process -FilePath (Join-Path $App "Slick.exe")',
      'Remove-Item -Recurse -Force (Split-Path $Stage -Parent)',
    ];
    fs.writeFileSync(ps1, lines.join(String.fromCharCode(13, 10)));
    spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        ps1,
        '-ProcId',
        String(process.pid),
        '-App',
        appDir,
        '-Stage',
        stage,
      ],
      { detached: true, stdio: 'ignore' },
    ).unref();
  }

  let progressWin = null;
  let progressData = null;

  function setp(frac) {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w || w.isDestroyed() || w === progressWin) continue;
      try {
        w.setProgressBar(frac);
      } catch {}
    }
  }

  function flushProgress() {
    if (!progressWin || progressWin.isDestroyed() || !progressData) return;
    progressWin.webContents
      .executeJavaScript('window.__update && window.__update(' + JSON.stringify(progressData) + ')')
      .catch(() => {});
  }

  function setProgress(data) {
    progressData = data;
    flushProgress();
  }

  function createProgressWindow() {
    if (progressWin && !progressWin.isDestroyed()) return progressWin;
    const opts = {
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
    if (MAC)
      Object.assign(opts, {
        titleBarStyle: 'hiddenInset',
        vibrancy: 'under-window',
        visualEffectState: 'active',
        backgroundColor: '#00000000',
      });
    else Object.assign(opts, { autoHideMenuBar: true, backgroundColor: '#f3f3f3' });
    progressWin = new BrowserWindow(opts);
    try {
      MAC ? progressWin.setMenu(null) : progressWin.setMenuBarVisibility(false);
    } catch {}
    progressWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(progressHtml()));
    progressWin.webContents.on('did-finish-load', flushProgress);
    progressWin.once('ready-to-show', () => {
      if (progressWin && !progressWin.isDestroyed()) progressWin.show();
    });
    progressWin.on('closed', () => {
      progressWin = null;
    });
    return progressWin;
  }

  function closeProgressWindow() {
    progressData = null;
    if (progressWin && !progressWin.isDestroyed()) progressWin.close();
    progressWin = null;
  }

  async function perform(release) {
    const asset = pickAsset(release);
    if (!asset || !asset.browser_download_url)
      return shell.openExternal(release.html_url || 'https://github.com/3kh0/slick/releases');
    const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'slick-update-'));
    const zip = path.join(dir, asset.name);
    const status = 'Slick Build ' + releaseBuild(release);
    const stageName = MAC ? 'Slick.app' : 'Slick';
    let stage;
    try {
      setp(0);
      createProgressWindow();
      setProgress({ title: 'Downloading update', status, percent: 0, pctText: '0%', detail: 'Starting…' });
      let lastTime = Date.now();
      let lastReceived = 0;
      let speed = 0;
      await download(asset.browser_download_url, zip, (received, total) => {
        const now = Date.now();
        const dt = (now - lastTime) / 1000;
        if (dt >= 0.25) {
          const inst = (received - lastReceived) / dt;
          speed = speed ? speed * 0.6 + inst * 0.4 : inst;
          lastTime = now;
          lastReceived = received;
        }
        const frac = total ? received / total : 0;
        const pct = Math.round(frac * 100);
        const rate = fmtBytes(speed) + '/s';
        setp(frac * 0.9);
        setProgress(
          total
            ? {
                title: 'Downloading update',
                status,
                percent: pct,
                pctText: pct + '%',
                detail:
                  fmtBytes(received) +
                  ' / ' +
                  fmtBytes(total) +
                  '  ·  ' +
                  rate +
                  '  ·  ' +
                  fmtEta((total - received) / speed) +
                  ' left',
              }
            : {
                title: 'Downloading update',
                status,
                indeterminate: true,
                pctText: '',
                detail: fmtBytes(received) + ' downloaded  ·  ' + rate,
              },
        );
      });
      setp(0.95);
      setProgress({ title: 'Installing update', status, indeterminate: true, pctText: '', detail: 'Extracting…' });
      await extract(zip, dir);
      stage = path.join(dir, stageName);
      if (!fs.existsSync(stage)) throw new Error('update archive did not contain ' + stageName);
      setp(1);
      setProgress({ title: 'Update ready', status, percent: 100, pctText: '100%', detail: 'Ready to restart.' });
    } catch (err) {
      setp(-1);
      closeProgressWindow();
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
      return dialog
        .showMessageBox({
          type: 'error',
          title: 'Slick update failed',
          message: 'Could not download the update',
          detail: String((err && err.message) || err) + '. You can download it manually instead.',
          buttons: ['Open Release Page', 'Later'],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) shell.openExternal(release.html_url || 'https://github.com/3kh0/slick/releases');
        })
        .catch(() => {});
    }

    setp(-1);
    closeProgressWindow();
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
      install(stage);
      app.quit();
      return;
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }

  function promptDownload(release, latestBuild) {
    return dialog
      .showMessageBox({
        type: 'info',
        title: 'Slick update available',
        message: 'Slick Build ' + latestBuild + ' is available',
        detail: 'You are running Build ' + build + '. Download it now and Slick will install it on the next restart.',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) return perform(release);
        return undefined;
      })
      .catch(() => {});
  }

  async function checkForUpdates() {
    if (!build) return;
    const now = Date.now();
    const state = readState();
    if (state.lastCheckedAt && now - state.lastCheckedAt < CINT) return;
    writeState({ ...state, lastCheckedAt: now });

    let release;
    try {
      release = await fetchLatestRelease();
    } catch {
      return;
    }

    const latestBuild = releaseBuild(release);
    if (latestBuild <= build) return;

    const promptState = readState();
    if (promptState.lastPromptedBuild === latestBuild && now - (promptState.lastPromptedAt || 0) < CINT) {
      return;
    }
    writeState({ ...promptState, lastPromptedBuild: latestBuild, lastPromptedAt: Date.now() });
    promptDownload(release, latestBuild);
  }

  async function manualCheckForUpdates() {
    if (!build) {
      dialog
        .showMessageBox({
          type: 'info',
          title: 'Slick updates',
          message: 'Update checking is unavailable',
          detail: 'This is a development build, so Slick cannot check for updates.',
          buttons: ['OK'],
        })
        .catch(() => {});
      return;
    }

    let release;
    try {
      writeState({ ...readState(), lastCheckedAt: Date.now() });
      release = await fetchLatestRelease();
    } catch (err) {
      dialog
        .showMessageBox({
          type: 'error',
          title: 'Slick update check failed',
          message: 'Could not check for updates',
          detail: String((err && err.message) || err) + '. Try again later.',
          buttons: ['OK'],
        })
        .catch(() => {});
      return;
    }

    const latestBuild = releaseBuild(release);
    if (latestBuild <= build) {
      dialog
        .showMessageBox({
          type: 'info',
          title: 'Slick is up to date',
          message: "You're running the latest version of Slick",
          detail: 'Build ' + build + ' is the newest available.',
          buttons: ['OK'],
        })
        .catch(() => {});
      return;
    }

    writeState({ ...readState(), lastPromptedBuild: latestBuild, lastPromptedAt: Date.now() });
    promptDownload(release, latestBuild);
  }

  function scheduleUpdateChecks() {
    if (!build) return;
    const run = () => {
      checkForUpdates();
      setTimeout(run, CINT);
    };
    app
      .whenReady()
      .then(() => {
        const state = readState();
        const elapsed = Date.now() - (state.lastCheckedAt || 0);
        const delay = state.lastCheckedAt ? Math.max(30 * 1000, CINT - elapsed) : 30 * 1000;
        setTimeout(run, delay);
      })
      .catch(() => {});
  }

  return { readState, scheduleUpdateChecks, manualCheckForUpdates };
}

module.exports = { create };
