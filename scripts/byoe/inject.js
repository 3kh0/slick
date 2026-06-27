'use strict';

const path = require('path');
const { execFile } = require('child_process');
const electron = require('electron');
const { app, session, Notification } = electron;
const PLUGINS_DIR = path.join(__dirname, '..', '..', 'plugins');
require('./switches').applySwitches({
  app,
  commandLine: app.commandLine,
  crashReporter: electron.crashReporter,
  pluginsDir: PLUGINS_DIR,
});

const perf = require('./perf');
perf.mark('inject.js start');

const fs = require('fs');
const { isDeepStrictEqual } = require('util');
const { allPluginSettings, buildCatalog, loadPlugins, mergeSettings } = require('./plugins');
const internals = require('./internals');
const settings = require('./settings-ui');
const { buildSpec } = require('../theme');
perf.mark('modules loaded');

const LAUNCHER_MS = process.env.SLICK_LAUNCH_T0
  ? Math.max(0, Math.round(performance.timeOrigin - Number(process.env.SLICK_LAUNCH_T0)))
  : 0;

const THEMES_DIR = path.join(__dirname, '..', '..', 'themes');
const SETTINGS_DIR = path.join(app.getPath('userData'), 'slick');
const ENABLED_FILE = path.join(SETTINGS_DIR, 'enabled-plugins.json');
const DEFAULT_ENABLED_FILE = path.join(PLUGINS_DIR, 'enabled.json');
const ACTIVE_THEME_FILE = path.join(SETTINGS_DIR, 'active-theme');
const PLUGIN_SETTINGS_FILE = path.join(SETTINGS_DIR, 'plugin-settings.json');
const catalog = buildCatalog({ pluginsDir: PLUGINS_DIR, themesDir: THEMES_DIR });
const defaultEnabled = () => catalog.plugins.map((plugin) => plugin.dir);
const readEnabled = () =>
  settings.readEnabled(ENABLED_FILE) || settings.readEnabled(DEFAULT_ENABLED_FILE) || defaultEnabled();
const runtime = {
  enabled: readEnabled(),
  pluginSettings: settings.readPluginSettings(PLUGIN_SETTINGS_FILE),
  theme: process.env.SLICK_THEME || settings.readActiveTheme(ACTIVE_THEME_FILE) || '',
};
let THEME_FILE = runtime.theme ? path.join(THEMES_DIR, `${runtime.theme}.json`) : null;

function themeCss() {
  const spec = buildSpec(THEME_FILE);
  const SEL = ':root,html,body,.sk-client-theme--dark,.sk-client-theme--light';
  const decls = Object.entries(spec.vars)
    .map(([k, v]) => `${k}:${v} !important`)
    .join(';');
  return { name: spec.name, css: (decls ? `${SEL}{${decls}}\n` : '') + (spec.css || '') };
}

let theme = { name: '', css: '' };
function rebuild() {
  if (!THEME_FILE) {
    theme = { name: '', css: '' };
    return;
  }
  try {
    theme = themeCss();
  } catch (e) {
    console.error(`[slick-byoe] theme load failed: ${e.message}`);
  }
}
const endTheme = perf.span();
rebuild();
endTheme(`theme "${theme.name || 'none'}" built`);

const endPlugins = perf.span();
const plugins = loadPlugins({
  catalog,
  enabled: runtime.enabled,
  electron,
  settings: runtime.pluginSettings,
});
endPlugins(`${plugins.loaded.length} plugin(s) loaded`);

const BOOT_LOG_FILE = path.join(SETTINGS_DIR, 'boot.log');
function bootLog(text) {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    try {
      if (fs.statSync(BOOT_LOG_FILE).size > 512 * 1024) fs.renameSync(BOOT_LOG_FILE, `${BOOT_LOG_FILE}.1`);
    } catch {}
    fs.appendFileSync(BOOT_LOG_FILE, `[${new Date().toISOString()}] ${text}\n`);
  } catch {}
}

const reportPerf = () => perf.report({ launcherMs: LAUNCHER_MS, pluginTimings: plugins.timings, sink: bootLog });
setTimeout(() => {
  reportPerf();
  if (!workspaceReady) bootLog('60s-timeout (workspace never rendered) ' + netSummary());
}, 60000).unref();

let nt = true;
const netInflight = new Map();
const netSlow = [];
function trackNet(sess) {
  try {
    sess.webRequest.onSendHeaders({ urls: ['*://*/*'] }, (d) => {
      if (nt) netInflight.set(d.id, { url: d.url, type: d.resourceType, start: performance.now() });
    });
    const done = (d, how) => {
      const e = netInflight.get(d.id);
      if (!e) return;
      netInflight.delete(d.id);
      const ms = Math.round(performance.now() - e.start);
      if ((ms >= 1000 || how !== 'ok') && how !== 'net::ERR_ABORTED')
        netSlow.push({ ms, startMs: Math.round(e.start), type: e.type, how, url: e.url });
    };
    sess.webRequest.onCompleted({ urls: ['*://*/*'] }, (d) => done(d, 'ok'));
    sess.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, (d) => done(d, d.error || 'error'));
  } catch (e) {}
}
function netSummary() {
  const now = performance.now();
  const top = (a) => a.toSorted((x, y) => y.ms - x.ms).slice(0, 12);
  const line = (r) =>
    `    ${r.ms}ms  ${r.type}  ${r.how ? r.how + '  ' : ''}[start +${r.startMs}ms]  ${String(r.url).slice(0, 110)}`;
  const pending = top(
    [...netInflight.values()]
      .map((e) => ({ ms: Math.round(now - e.start), startMs: Math.round(e.start), type: e.type, url: e.url }))
      .filter((p) => p.ms >= 1000),
  );
  const slow = top(netSlow);
  const L = ['network tap (ms since electron start in [..]):'];
  if (slow.length) L.push('  slow/failed completed requests:', ...slow.map(line));
  if (pending.length)
    L.push('  STILL PENDING at workspace-ready (>1s; a websocket here is normal/expected):', ...pending.map(line));
  if (!slow.length && !pending.length) L.push('  nothing >1s and nothing pending — boot was not network-blocked');
  return L.join('\n');
}

function pluginCss() {
  const dynamic = plugins.cssFns.map(({ name, schema, fn }) => {
    try {
      return fn(mergeSettings(schema, runtime.pluginSettings[name]));
    } catch (e) {
      console.error(`[slick-byoe] plugin "${name}" css() failed: ${e.message}`);
      return '';
    }
  });
  return plugins.css.concat(dynamic).filter(Boolean).join('\n');
}

function fullCss() {
  return [theme.css, pluginCss()].filter(Boolean).join('\n');
}

const armedSessions = new WeakSet();
function armBlocking(sess) {
  if (!sess || armedSessions.has(sess)) return;
  armedSessions.add(sess);
  const urls = plugins.block.concat(
    plugins.requests.flatMap((request) => request.urls),
    settings.controlPattern,
  );
  sess.webRequest.onBeforeRequest({ urls }, (details, cb) => {
    if (process.env.SLICK_DBG) console.log('[slick-dbg] intercepted', details.url);
    if (details.url.startsWith('https://slick.control/') || details.url.startsWith('http://slick.control/')) {
      settings.handleControl(details.url, {
        catalog,
        enabledFile: ENABLED_FILE,
        defaultEnabledFile: DEFAULT_ENABLED_FILE,
        activeThemeFile: ACTIVE_THEME_FILE,
        pluginSettingsFile: PLUGIN_SETTINGS_FILE,
        app,
        onTheme: setTheme,
        onEnabled: setEnabled,
        onPluginSetting: (_dir, _key, _value, all) => setPluginSettings(all),
        onFileSetting: () =>
          electron.dialog
            .showOpenDialog({
              title: 'Choose file',
              properties: ['openFile'],
              filters: [
                {
                  name: 'Audio',
                  extensions: ['aac', 'aif', 'aiff', 'caf', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'webm'],
                },
              ],
            })
            .then((r) => (r.canceled ? '' : r.filePaths[0] || '')),
      });
      cb({ cancel: true });
      return;
    }
    for (const request of plugins.requests) {
      try {
        const response = request.handler(details);
        if (!response) continue;
        if (response.cancel) blockedCount++;
        cb(response);
        return;
      } catch (e) {
        console.error(`[slick-byoe] request interceptor "${request.name}" failed: ${e.message}`);
        blockedCount++;
        cb({ cancel: true });
        return;
      }
    }
    blockedCount++;
    cb({ cancel: true });
  });
}
let blockedCount = 0;

const HOSTS = ['slack.com', 'slack-edge.com', 'slackb.com'];
const PERMS = new Set([
  'display-capture',
  'fullscreen',
  'media',
  'notifications',
  'speaker-selection',
  'window-management',
]);

function hfu(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

function isSlack(host) {
  return HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
}

function po(webContents, requestingOrigin, details = {}) {
  const origins = [requestingOrigin, details.securityOrigin, details.requestingUrl, details.embeddingOrigin].filter(
    Boolean,
  );
  try {
    if (webContents && !webContents.isDestroyed()) origins.push(webContents.getURL());
  } catch {}
  return origins;
}

function isPerm(webContents, requestingOrigin, details) {
  return po(webContents, requestingOrigin, details).some((origin) => isSlack(hfu(origin)));
}

function isMedia(permission, details = {}) {
  if (permission !== 'media') return true;
  if (Array.isArray(details.mediaTypes))
    return details.mediaTypes.every((type) => type === 'audio' || type === 'video');
  return (
    !details.mediaType ||
    details.mediaType === 'audio' ||
    details.mediaType === 'video' ||
    details.mediaType === 'unknown'
  );
}

function canGrant(webContents, permission, requestingOrigin, details) {
  return PERMS.has(permission) && isMedia(permission, details) && isPerm(webContents, requestingOrigin, details);
}

function permD(webContents, requestingOrigin, details = {}) {
  const origins = po(webContents, requestingOrigin, details);
  return origins.find(Boolean) || 'unknown-origin';
}

function ap(sess) {
  if (!sess) return;
  sess.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = canGrant(webContents, permission, details?.securityOrigin || '', details);
    if (process.env.SLICK_DBG) {
      console.log(
        `[slick-dbg] permission request ${permission} ${allowed ? 'allow' : 'deny'} ${permD(
          webContents,
          details?.securityOrigin || '',
          details,
        )}`,
      );
    }
    callback(allowed);
  });
  sess.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const allowed = canGrant(webContents, permission, requestingOrigin, details);
    if (process.env.SLICK_DBG) {
      console.log(
        `[slick-dbg] permission check ${permission} ${allowed ? 'allow' : 'deny'} ${permD(
          webContents,
          requestingOrigin,
          details,
        )}`,
      );
    }
    return allowed;
  });
}

app.on('session-created', armBlocking);
app.on('session-created', ap);

function installNotificationSounds() {
  if (process.platform !== 'darwin') return;
  const R = '/Applications/Slack.app/Contents/Resources';
  const s = path.join(app.getPath('home'), 'Library', 'Sounds');
  let names;
  try {
    names = fs.readdirSync(R).filter((f) => f.endsWith('.mp3'));
  } catch {
    return;
  }
  if (!names.length) return;
  try {
    fs.mkdirSync(s, { recursive: true });
  } catch {
    return;
  }
  for (const name of names) {
    const src = path.join(R, name);
    const dest = path.join(s, name.replace(/\.mp3$/, '.caf'));
    try {
      const srcStat = fs.statSync(src);
      let destStat;
      try {
        destStat = fs.statSync(dest);
      } catch {}
      if (destStat && destStat.mtimeMs >= srcStat.mtimeMs) continue; // already current
    } catch {
      continue;
    }
    execFile('/usr/bin/afconvert', ['-f', 'caff', '-d', 'LEI16', src, dest], (e) => {
      if (e) console.error(`[slick-byoe] notification sound convert failed (${name}): ${e.message}`);
    });
  }
}

function requestNoti() {
  try {
    if (!Notification.isSupported()) return; // unlikely, but just in case
    const marker = path.join(app.getPath('userData'), '.slick-notif-prompt');
    if (fs.existsSync(marker)) return;
    const n = new Notification({
      title: 'Slick',
      body: 'Notifications are enabled! Manage them in System Settings -> Notifications.',
    });
    n.show();
    fs.writeFileSync(marker, '');
  } catch (e) {
    console.error('[slick-byoe] notification request fail:', e.message);
  }
}

app.whenReady().then(() => {
  perf.mark('app ready');
  armBlocking(session.defaultSession);
  ap(session.defaultSession);
  trackNet(session.defaultSession);
  if (process.env.SLICK_DBG) {
    session.defaultSession.cookies.on('changed', (_e, c, cause, removed) => {
      if (c.name.startsWith('d'))
        console.log(`[slick-dbg] cookie ${c.name} ${removed ? 'REMOVED' : 'SET'} cause=${cause} domain=${c.domain}`);
    });
  }
  for (const url of ['https://app.slack.com', 'https://a.slack-edge.com', 'https://wss-primary.slack.com']) {
    try {
      session.defaultSession.preconnect({ url, numSockets: 2 });
    } catch (e) {
      console.error(`[slick-byoe] preconnect failed for ${url}: ${e.message}`);
    }
  }
  requestNoti();
  installNotificationSounds();
});

const BOOT_PROBE_JS = `(() => {
  if (window.__slickBootProbe) return;
  const p = (window.__slickBootProbe = { longtasks: 0, longtaskMs: 0, maxLongtask: 0, sw: [] });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        p.longtasks++;
        p.longtaskMs += e.duration;
        p.maxLongtask = Math.max(p.maxLongtask, e.duration);
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  try {
    const sw = navigator.serviceWorker;
    if (sw) {
      p.sw.push('start:' + (sw.controller ? sw.controller.state : 'none'));
      sw.addEventListener('controllerchange', () =>
        p.sw.push('change@' + Math.round(performance.now()) + 'ms:' + (sw.controller ? sw.controller.state : 'none')),
      );
    }
  } catch (e) {}
})()`;

const WORKSPACE_READY_JS = `(() => {
  const SEL = '.p-client_workspace, .p-workspace__primary_view';
  const host = (u) => { try { return new URL(u).host; } catch (e) { return '?'; } };
  const result = () => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const res = performance.getEntriesByType('resource') || [];
    const slow = res
      .filter((r) => r.duration > 1000)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 12)
      .map((r) => ({
        host: host(r.name),
        name: (r.name.split('?')[0].split('/').pop() || host(r.name)).slice(0, 48),
        ms: Math.round(r.duration),
        start: Math.round(r.startTime),
        type: r.initiatorType,
      }));
    const hostMs = {};
    for (const r of res) { const h = host(r.name); hostMs[h] = (hostMs[h] || 0) + r.duration; }
    const topHosts = Object.entries(hostMs).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h, ms]) => ({ host: h, ms: Math.round(ms) }));
    const p = window.__slickBootProbe || {};
    const sw = navigator.serviceWorker;
    return {
      readyMs: Math.round(performance.now()),
      dclMs: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : 0,
      responseEnd: nav.responseEnd ? Math.round(nav.responseEnd) : 0,
      domInteractive: nav.domInteractive ? Math.round(nav.domInteractive) : 0,
      loadEnd: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : 0,
      resources: res.length,
      slow,
      topHosts,
      longtasks: p.longtasks || 0,
      longtaskMs: Math.round(p.longtaskMs || 0),
      maxLongtask: Math.round(p.maxLongtask || 0),
      swState: sw && sw.controller ? sw.controller.state : 'none',
      swEvents: p.sw || [],
    };
  };
  return new Promise((resolve) => {
    if (document.querySelector(SEL)) return resolve(result());
    const mo = new MutationObserver(() => {
      if (!document.querySelector(SEL)) return;
      mo.disconnect();
      resolve(result());
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { mo.disconnect(); resolve(result()); }, 120000);
  });
})()`;

function formatBootDiag(r) {
  const L = [
    `boot diagnostics (workspace ${r.readyMs}ms after nav):`,
    `  nav: responseEnd ${r.responseEnd}ms, domInteractive ${r.domInteractive}ms, dom-content-loaded ${r.dclMs}ms, load ${r.loadEnd}ms`,
    `  service worker: controller=${r.swState}${r.swEvents.length ? ' [' + r.swEvents.join(', ') + ']' : ''}`,
    `  main-thread long tasks: ${r.longtasks} totalling ${r.longtaskMs}ms (longest ${r.maxLongtask}ms)`,
    `  ${r.resources} resources; busiest hosts: ${r.topHosts.map((h) => `${h.host} ${h.ms}ms`).join(', ') || 'none'}`,
  ];
  if (r.slow.length)
    L.push(
      '  slowest resources (>1s):',
      ...r.slow.map((s) => `    ${s.ms}ms  ${s.host}  ${s.type}  ${s.name} (start +${s.start}ms)`),
    );
  else L.push('  no single resource took >1s -> stall is JS/render or service-worker bound, not a slow fetch');
  return L.join('\n');
}

const consoleBuf = [];
function captureConsole(e, level, message) {
  const msg = message ?? e?.message;
  if (workspaceReady || consoleBuf.length >= 1200 || msg == null) return;
  consoleBuf.push({ t: Math.round(performance.now()), lvl: level ?? e?.level, msg: String(msg).slice(0, 240) });
}
function dumpConsole(reason) {
  if (!consoleBuf.length) return;
  const tail = consoleBuf.slice(-200);
  const L = [
    `renderer console trace (${reason}; last ${tail.length} of ${consoleBuf.length} lines, +ms since electron start):`,
  ];
  for (const c of tail) L.push(`  +${c.t}ms [${c.lvl}] ${c.msg}`);
  bootLog(L.join('\n'));
}

let workspaceReady = false;
function watchWorkspaceReady(wc) {
  wc.mainFrame
    .executeJavaScript(WORKSPACE_READY_JS, true)
    .then((r) => {
      if (!r || workspaceReady) return;
      workspaceReady = true;
      clearTimeout(stallTimer);
      perf.mark(`workspace ready (page: dom-content-loaded ${r.dclMs}ms, workspace ${r.readyMs}ms after nav)`);
      reportPerf();
      bootLog(formatBootDiag(r));
      bootLog(netSummary());
      if (r.readyMs > 5000) dumpConsole(`slow boot, workspace ${r.readyMs}ms`);
      nt = false;
      netInflight.clear();
      consoleBuf.length = 0;
    })
    .catch(() => {});
}

let bootReloads = 0;
let stallTimer = null;
function armStallWatchdog(wc) {
  if (workspaceReady) return;
  const u = URL.parse(wc.getURL());
  if (!u || u.hostname !== 'app.slack.com' || !u.pathname.startsWith('/client')) return;
  clearTimeout(stallTimer);
  stallTimer = setTimeout(() => {
    if (workspaceReady || wc.isDestroyed()) return;
    if (bootReloads >= 2) {
      bootLog(`boot-stall watchdog: still not ready after ${bootReloads} reload(s); letting Slack's own fallback ride`);
      return;
    }
    bootReloads++;
    bootLog(
      `boot-stall watchdog: workspace not ready 3000ms after dom-ready -> reload ${bootReloads}/${2} (url ${wc.getURL()})`,
    );
    dumpConsole(`boot stall, reload ${bootReloads}`);
    try {
      wc.reload();
    } catch (e) {}
  }, 3000);
}

const live = new Map();
const applyQueue = new WeakMap();
const documents = new WeakMap();

function applyTo(wc, options = {}) {
  const prev = applyQueue.get(wc) || Promise.resolve();
  const next = prev
    .then(() => doApplyTo(wc, options))
    .catch((e) => console.error('[slick-byoe] applyTo failed:', e.message));
  applyQueue.set(wc, next);
  return next;
}

function runtimeManifest() {
  return settings.buildManifest({
    catalog,
    enabled: runtime.enabled,
    activeTheme: runtime.theme,
    pluginSettings: runtime.pluginSettings,
  });
}

function pushRuntimeSettings(wc) {
  const cfg = allPluginSettings(catalog, runtime.pluginSettings);
  const manifest = runtimeManifest();
  return wc.mainFrame.executeJavaScript(
    `window.__slickPluginSettings = ${JSON.stringify(cfg)};` +
      `window.__slickSettings = Object.assign(window.__slickSettings || {}, ${JSON.stringify(manifest)});` +
      `window.dispatchEvent(new CustomEvent('slick:plugin-settings'));` +
      `window.dispatchEvent(new CustomEvent('slick:settings'));`,
    true,
  );
}

let perfApplied = false;
async function doApplyTo(wc, { initialize = false, refreshCss = true } = {}) {
  if (wc.isDestroyed()) return;
  const document = documents.get(wc) || { initialized: false };
  if (!documents.has(wc)) documents.set(wc, document);
  const shouldInitialize = initialize || !document.initialized;
  const track = !perfApplied && URL.parse(wc.getURL())?.hostname === 'app.slack.com';
  if (track) perfApplied = true;
  if (refreshCss) {
    const css = fullCss();
    const oldKeys = live.get(wc) || [];
    let newKeys = oldKeys;
    if (css) {
      const endCss = track && perf.span();
      try {
        const key = await wc.insertCSS(css);
        newKeys = [key];
        if (track) endCss(`css injected (${(css.length / 1024).toFixed(1)} kB)`);
      } catch (e) {
        console.error('[slick-byoe] insertCSS failed:', e.message);
        return;
      }
    } else {
      newKeys = [];
    }
    live.set(wc, newKeys);
    for (const key of oldKeys) {
      try {
        await wc.removeInsertedCSS(key);
      } catch {}
    }
  }
  try {
    await pushRuntimeSettings(wc);
  } catch (e) {
    console.error('[slick-byoe] plugin settings push failed:', e.message);
  }
  if (shouldInitialize) {
    const endJs = track && perf.span();
    if (internals.enabled() || plugins.needsInternals) {
      try {
        await wc.mainFrame.executeJavaScript(internals.source, true);
      } catch (e) {
        console.error('[slick-byoe] internals init failed:', e.message);
      }
    }
    const jsDone = plugins.js.map((js) =>
      wc.mainFrame.executeJavaScript(js, true).catch((e) => console.error('[slick-byoe] plugin JS failed:', e.message)),
    );
    try {
      const boot = settings.bootstrapScript(runtimeManifest());
      jsDone.push(
        wc.mainFrame
          .executeJavaScript(boot, true)
          .catch((e) => console.error('[slick-byoe] settings UI failed:', e.message)),
      );
    } catch (e) {
      console.error('[slick-byoe] settings build failed:', e.message);
    }
    await Promise.all(jsDone);
    document.initialized = true;
    if (track) endJs('plugin js + settings ui injected');
  }
}

let firstWindow = true;
let clientDomReady = false;
app.on('browser-window-created', (_event, win) => {
  if (firstWindow) {
    firstWindow = false;
    perf.mark('first window created');
  }
  const wc = win.webContents;
  armBlocking(wc.session);
  ap(wc.session);
  setImmediate(() => ap(wc.session));
  wc.on('console-message', captureConsole);
  let unresponsiveAt = 0;
  wc.on('unresponsive', () => {
    unresponsiveAt = performance.now();
    bootLog(
      `renderer UNRESPONSIVE (wc${wc.id}, +${Math.round(unresponsiveAt)}ms since electron start, url ${wc.getURL()})`,
    );
    bootLog('at-unresponsive ' + netSummary());
    dumpConsole('at-unresponsive');
  });
  wc.on('responsive', () => {
    const ms = unresponsiveAt ? Math.round(performance.now() - unresponsiveAt) : 0;
    bootLog(`renderer responsive again (wc${wc.id}, was hung ~${ms}ms)`);
    unresponsiveAt = 0;
  });
  wc.on('render-process-gone', (_e, details) =>
    bootLog(`render-process-gone (wc${wc.id}, reason=${details.reason}, exitCode=${details.exitCode})`),
  );
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (code === -3) return;
    bootLog(`did-fail-load (wc${wc.id}, code=${code} ${desc}, mainFrame=${isMainFrame}, ${String(url).slice(0, 140)})`);
  });
  if (process.env.SLICK_DBG) {
    wc.on('did-navigate', (_e, url) => console.log(`[slick-dbg] wc${wc.id} did-navigate ${url}`));
    wc.on('did-frame-navigate', (_e, url, code, _s, isMain) => {
      if (!isMain) console.log(`[slick-dbg] wc${wc.id} SUBFRAME ${code} ${url}`);
    });
    wc.on('did-navigate-in-page', (_e, url) => console.log(`[slick-dbg] wc${wc.id} in-page ${url}`));
    wc.on('did-fail-load', (_e, code, desc, url) => console.log(`[slick-dbg] wc${wc.id} FAIL ${code} ${desc} ${url}`));
    wc.on('destroyed', () => console.log(`[slick-dbg] wc${wc.id} destroyed`));
  }
  for (const hook of plugins.windowHooks) {
    try {
      hook(win);
    } catch (e) {
      console.error('[slick-byoe] plugin window hook failed:', e.message);
    }
  }
  wc.on('dom-ready', () => {
    documents.set(wc, { initialized: false });
    if (!clientDomReady && URL.parse(wc.getURL())?.hostname === 'app.slack.com') {
      clientDomReady = true;
      perf.mark('client dom-ready');
    }
    if (!workspaceReady) wc.mainFrame.executeJavaScript(BOOT_PROBE_JS, true).catch(() => {});
    applyTo(wc, { initialize: true });
    if (!workspaceReady) {
      watchWorkspaceReady(wc);
      armStallWatchdog(wc);
    }
  });
  wc.on('destroyed', () => live.delete(wc));
});

function applyAllLive(options) {
  for (const wc of live.keys()) applyTo(wc, options);
}

function onThemeFileChanged(curr, prev) {
  if (curr.mtimeMs === prev.mtimeMs) return;
  rebuild();
  applyAllLive({ refreshCss: true });
  console.log(`[slick-byoe] hot-reloaded "${theme.name}" (${theme.css.length} bytes) -> ${live.size} window(s)`);
}
function watchTheme() {
  if (!THEME_FILE) return;
  fs.watchFile(THEME_FILE, { interval: 300 }, onThemeFileChanged);
  console.log(`[slick-byoe] watching ${path.basename(THEME_FILE)} for live edits`);
}
watchTheme();

function setTheme(name) {
  name = name || '';
  if (name === runtime.theme) return;
  const file = name ? path.join(THEMES_DIR, `${name}.json`) : null;
  if (file && !fs.existsSync(file)) {
    console.error(`[slick-byoe] theme not found: ${name}`);
    return;
  }
  if (THEME_FILE) fs.unwatchFile(THEME_FILE, onThemeFileChanged);
  runtime.theme = name;
  THEME_FILE = file;
  rebuild();
  watchTheme();
  applyAllLive({ refreshCss: true });
  console.log(`[slick-byoe] theme switched -> "${theme.name || 'none'}" -> ${live.size} window(s)`);
}

function setEnabled(names) {
  if (!Array.isArray(names) || isDeepStrictEqual(names, runtime.enabled)) return;
  runtime.enabled = names;
  applyAllLive({ refreshCss: false });
}

function setPluginSettings(all) {
  if (!all || typeof all !== 'object' || Array.isArray(all) || isDeepStrictEqual(all, runtime.pluginSettings)) return;
  runtime.pluginSettings = all;
  applyAllLive({ refreshCss: true });
}

function watchRuntimeFile(file, read, update) {
  fs.watchFile(file, { interval: 300 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    update(read());
  });
}

watchRuntimeFile(ENABLED_FILE, readEnabled, setEnabled);
watchRuntimeFile(ACTIVE_THEME_FILE, () => settings.readActiveTheme(ACTIVE_THEME_FILE) || '', setTheme);
watchRuntimeFile(PLUGIN_SETTINGS_FILE, () => settings.readPluginSettings(PLUGIN_SETTINGS_FILE), setPluginSettings);

const blockedPatternCount =
  plugins.block.length + plugins.requests.reduce((count, request) => count + request.urls.length, 0);
if (blockedPatternCount) {
  setInterval(() => {
    if (blockedCount) console.log(`[slick-byoe] blocked ${blockedCount} network request(s) so far`);
  }, 30000).unref();
}

console.log(
  `[slick-byoe] armed: theme ${theme.name ? `"${theme.name}" (${theme.css.length} bytes)` : 'none'}` +
    ` + ${plugins.loaded.length} plugin(s): ${plugins.loaded.join(', ') || 'none'}` +
    (blockedPatternCount ? ` | blocking ${blockedPatternCount} URL pattern(s)` : ''),
);
