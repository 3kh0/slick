'use strict';

const fs = require('fs');
const path = require('path');
const electron = require('electron');
const { app, session } = electron;
const { loadPlugins } = require('./plugins');
const settings = require('./settings-ui');
const { buildSpec } = require('../theme');

const THEMES_DIR = path.join(__dirname, '..', '..', 'themes');
const PLUGINS_DIR = path.join(__dirname, '..', '..', 'plugins');
let THEME = process.env.SLICK_THEME || settings.readActiveTheme(THEMES_DIR) || '';
let THEME_FILE = THEME ? path.join(THEMES_DIR, `${THEME}.json`) : null;

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
rebuild();

const plugins = loadPlugins({ pluginsDir: PLUGINS_DIR, electron });
const pluginCss = plugins.css.join('\n');

function fullCss() {
  return theme.css + (pluginCss ? '\n' + pluginCss : '');
}

const armedSessions = new WeakSet();
function armBlocking(sess) {
  if (!sess || armedSessions.has(sess)) return;
  armedSessions.add(sess);
  const urls = plugins.block.concat([settings.controlPattern]);
  sess.webRequest.onBeforeRequest({ urls }, (details, cb) => {
    if (
      settings.handleControl(details.url, { pluginsDir: PLUGINS_DIR, themesDir: THEMES_DIR, app, onTheme: setTheme })
    ) {
      cb({ cancel: true });
      return;
    }
    blockedCount++;
    cb({ cancel: true });
  });
}
let blockedCount = 0;
app.whenReady().then(() => armBlocking(session.defaultSession));

const live = new Map();
const applyQueue = new WeakMap();

function applyTo(wc) {
  const prev = applyQueue.get(wc) || Promise.resolve();
  const next = prev.then(() => doApplyTo(wc)).catch((e) => console.error('[slick-byoe] applyTo failed:', e.message));
  applyQueue.set(wc, next);
  return next;
}

async function doApplyTo(wc) {
  if (wc.isDestroyed()) return;
  const css = fullCss();
  const oldKeys = live.get(wc) || [];
  let newKeys = oldKeys;
  if (css) {
    try {
      const key = await wc.insertCSS(css);
      newKeys = [key];
    } catch (e) {
      console.error('[slick-byoe] insertCSS failed:', e.message);
      return;
    }
  } else {
    newKeys = [];
  }
  live.set(wc, newKeys);
  for (const k of oldKeys) {
    try {
      await wc.removeInsertedCSS(k);
    } catch (e) {}
  }
  for (const js of plugins.js) {
    wc.executeJavaScript(js, true).catch((e) => console.error('[slick-byoe] plugin JS failed:', e.message));
  }
  try {
    const boot = settings.bootstrapScript(
      settings.buildManifest({ pluginsDir: PLUGINS_DIR, themesDir: THEMES_DIR, activeTheme: THEME }),
    );
    wc.executeJavaScript(boot, true).catch((e) => console.error('[slick-byoe] settings UI failed:', e.message));
  } catch (e) {
    console.error('[slick-byoe] settings build failed:', e.message);
  }
}

app.on('browser-window-created', (_event, win) => {
  const wc = win.webContents;
  armBlocking(wc.session);
  for (const hook of plugins.windowHooks) {
    try {
      hook(win);
    } catch (e) {
      console.error('[slick-byoe] plugin window hook failed:', e.message);
    }
  }
  wc.on('dom-ready', () => applyTo(wc));
  wc.on('did-navigate', () => applyTo(wc));
  wc.on('destroyed', () => live.delete(wc));
});

function applyAllLive() {
  for (const wc of live.keys()) applyTo(wc);
}

function onThemeFileChanged(curr, prev) {
  if (curr.mtimeMs === prev.mtimeMs) return;
  rebuild();
  applyAllLive();
  console.log(`[slick-byoe] hot-reloaded "${theme.name}" (${theme.css.length} bytes) -> ${live.size} window(s)`);
}
function watchTheme() {
  if (!THEME_FILE) return;
  fs.watchFile(THEME_FILE, { interval: 300 }, onThemeFileChanged);
  console.log(`[slick-byoe] watching ${path.basename(THEME_FILE)} for live edits`);
}
watchTheme();

function setTheme(name) {
  const file = name ? path.join(THEMES_DIR, `${name}.json`) : null;
  if (file && !fs.existsSync(file)) {
    console.error(`[slick-byoe] theme not found: ${name}`);
    return;
  }
  if (THEME_FILE) fs.unwatchFile(THEME_FILE, onThemeFileChanged);
  THEME = name || '';
  THEME_FILE = file;
  rebuild();
  watchTheme();
  applyAllLive();
  console.log(`[slick-byoe] theme switched -> "${theme.name || 'none'}" -> ${live.size} window(s)`);
}

if (plugins.block.length) {
  setInterval(() => {
    if (blockedCount) console.log(`[slick-byoe] blocked ${blockedCount} telemetry request(s) so far`);
  }, 30000).unref();
}

console.log(
  `[slick-byoe] armed: theme ${theme.name ? `"${theme.name}" (${theme.css.length} bytes)` : 'none'}` +
    ` + ${plugins.loaded.length} plugin(s): ${plugins.loaded.join(', ') || 'none'}` +
    (plugins.block.length ? ` | blocking ${plugins.block.length} URL pattern(s)` : ''),
);
