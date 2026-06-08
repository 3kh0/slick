'use strict';

const path = require('path');
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

const reportPerf = () => perf.report({ launcherMs: LAUNCHER_MS, pluginTimings: plugins.timings });
setTimeout(reportPerf, 60000).unref();

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
app.on('session-created', armBlocking);

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
});

const WORKSPACE_READY_JS = `(() => {
  const SEL = '.p-client_workspace, .p-workspace__primary_view';
  const result = () => {
    const nav = performance.getEntriesByType('navigation')[0];
    return { readyMs: Math.round(performance.now()), dclMs: nav ? Math.round(nav.domContentLoadedEventEnd) : 0 };
  };
  return new Promise((resolve) => {
    if (document.querySelector(SEL)) return resolve(result());
    const mo = new MutationObserver(() => {
      if (!document.querySelector(SEL)) return;
      mo.disconnect();
      resolve(result());
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { mo.disconnect(); resolve(null); }, 120000);
  });
})()`;

let workspaceReady = false;
function watchWorkspaceReady(wc) {
  wc.mainFrame
    .executeJavaScript(WORKSPACE_READY_JS, true)
    .then((r) => {
      if (!r || workspaceReady) return;
      workspaceReady = true;
      perf.mark(`workspace ready (page: dom-content-loaded ${r.dclMs}ms, workspace ${r.readyMs}ms after nav)`);
      reportPerf();
    })
    .catch(() => {});
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
  const track = !perfApplied && wc.getURL().includes('app.slack.com');
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
    if (!clientDomReady && wc.getURL().includes('app.slack.com')) {
      clientDomReady = true;
      perf.mark('client dom-ready');
    }
    applyTo(wc, { initialize: true });
    if (!workspaceReady) watchWorkspaceReady(wc);
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
