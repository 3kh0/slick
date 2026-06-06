'use strict';

const fs = require('fs');
const path = require('path');
const { pluginDirs } = require('./plugins');

const CONTROL_HOST = 'slick.control';
const controlPattern = `*://${CONTROL_HOST}/*`;
const controlUrl = `https://${CONTROL_HOST}/`;
const RENDERER_FILE = path.join(__dirname, 'settings-renderer.js');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function readEnabled(file) {
  try {
    const arr = readJson(file);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function writeEnabled(file, names) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(names, null, 2) + '\n');
}

function readActiveTheme(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}
function writeActiveTheme(file, name) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(name).trim() + '\n');
}

function listThemes(themesDir, activeName) {
  let files = [];
  try {
    files = fs.readdirSync(themesDir).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  } catch {}
  return files.map((f) => {
    const file = f.replace(/\.json$/, '');
    let t = {};
    try {
      t = readJson(path.join(themesDir, f));
    } catch {}
    return { file, label: t.name || file, description: t.description || '', active: file === activeName };
  });
}

function buildManifest({ pluginsDir, themesDir, enabled, activeTheme }) {
  const plugins = pluginDirs(pluginsDir).map((dir) => {
    let meta = {};
    try {
      meta = require(path.join(pluginsDir, dir, 'index.js')).meta || {};
    } catch (e) {
      meta = { description: `(failed to load: ${e.message})` };
    }
    return {
      dir,
      name: meta.name || dir,
      version: meta.version || '',
      description: meta.description || '',
      enabled: enabled ? enabled.includes(dir) : true,
    };
  });
  const themes = themesDir ? listThemes(themesDir, activeTheme) : [];
  themes.unshift({
    file: '',
    label: 'Default',
    description: 'Stock Slack appearance (no theme)',
    active: !themes.some((t) => t.active),
  });
  return {
    controlUrl,
    theme: activeTheme || '',
    themes,
    plugins,
  };
}

function bootstrapScript(manifest) {
  return `window.__slickSettings = ${JSON.stringify(manifest)};\n${fs.readFileSync(RENDERER_FILE, 'utf8')}`;
}

function setPluginEnabled(pluginsDir, enabledFile, defaultEnabledFile, dir, on) {
  const set = new Set(readEnabled(enabledFile) || readEnabled(defaultEnabledFile) || pluginDirs(pluginsDir));
  on ? set.add(dir) : set.delete(dir);
  const names = pluginDirs(pluginsDir).filter((n) => set.has(n));
  writeEnabled(enabledFile, names);
  return names;
}

function handleControl(
  rawUrl,
  { pluginsDir, themesDir, enabledFile, defaultEnabledFile, activeThemeFile, app, onTheme },
) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.host !== CONTROL_HOST) return false;
  const op = u.searchParams.get('op');
  if (op === 'toggle') {
    const dir = u.searchParams.get('plugin');
    const on = u.searchParams.get('enabled') === '1';
    if (dir) {
      const names = setPluginEnabled(pluginsDir, enabledFile, defaultEnabledFile, dir, on);
      console.log(
        `[slick-settings] ${dir} -> ${on ? 'enabled' : 'disabled'} (enabled now: ${names.join(', ') || 'none'})`,
      );
    }
  } else if (op === 'theme') {
    const name = u.searchParams.get('name');
    if (name !== null && themesDir && (name === '' || listThemes(themesDir).some((t) => t.file === name))) {
      writeActiveTheme(activeThemeFile, name);
      console.log(`[slick-settings] theme -> ${name || 'none'}`);
      if (onTheme) {
        try {
          onTheme(name);
        } catch (e) {
          console.error('[slick-settings] onTheme failed:', e.message);
        }
      }
    }
  } else if (op === 'restart') {
    console.log('[slick-settings] relaunching to apply plugin changes');
    if (app) {
      app.relaunch();
      app.exit(0);
    }
  }
  return true;
}

module.exports = {
  CONTROL_HOST,
  controlPattern,
  controlUrl,
  buildManifest,
  bootstrapScript,
  handleControl,
  readEnabled,
  writeEnabled,
  listThemes,
  readActiveTheme,
  writeActiveTheme,
};
