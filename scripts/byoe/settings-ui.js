'use strict';

const fs = require('fs');
const path = require('path');
const { allPluginSettings, mergeSettings, coerceSetting } = require('./plugins');

const CONTROL_HOST = 'slick.control';
const controlPattern = `*://${CONTROL_HOST}/*`;
const controlUrl = `https://${CONTROL_HOST}/`;
const RENDERER_FILE = path.join(__dirname, 'settings-renderer.js');
const RENDERER_SOURCE = fs.readFileSync(RENDERER_FILE, 'utf8');

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

function readPluginSettings(file) {
  try {
    const o = readJson(file);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

function writePluginSetting(file, plugin, key, value) {
  const all = readPluginSettings(file);
  all[plugin] = { ...all[plugin], [key]: value };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
  return all;
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

function listThemes(catalog, activeName) {
  return catalog.themes.map((theme) => ({ ...theme, active: theme.file === activeName }));
}

function buildManifest({ catalog, enabled, activeTheme, pluginSettings }) {
  const plugins = catalog.plugins.map(({ dir, meta, schema }) => {
    return {
      dir,
      name: meta.name || dir,
      description: meta.description || '',
      enabled: enabled ? enabled.includes(dir) : true,
      settings: schema,
      values: mergeSettings(schema, (pluginSettings || {})[dir]),
    };
  });
  const themes = listThemes(catalog, activeTheme);
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
  return `window.__slickSettings = Object.assign(window.__slickSettings || {}, ${JSON.stringify(manifest)});\n${RENDERER_SOURCE}`;
}

function setPluginEnabled(catalog, enabledFile, defaultEnabledFile, dir, on) {
  const dirs = catalog.plugins.map((plugin) => plugin.dir);
  const set = new Set(readEnabled(enabledFile) || readEnabled(defaultEnabledFile) || dirs);
  on ? set.add(dir) : set.delete(dir);
  const names = dirs.filter((name) => set.has(name));
  writeEnabled(enabledFile, names);
  return names;
}

function handleControl(
  rawUrl,
  {
    catalog,
    enabledFile,
    defaultEnabledFile,
    activeThemeFile,
    pluginSettingsFile,
    app,
    onTheme,
    onEnabled,
    onPluginSetting,
    onFileSetting,
  },
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
    if (dir && catalog.plugins.some((plugin) => plugin.dir === dir)) {
      const names = setPluginEnabled(catalog, enabledFile, defaultEnabledFile, dir, on);
      console.log(
        `[slick-settings] ${dir} -> ${on ? 'enabled' : 'disabled'} (enabled now: ${names.join(', ') || 'none'})`,
      );
      if (onEnabled) onEnabled(names);
    }
  } else if (op === 'theme') {
    const name = u.searchParams.get('name');
    if (name !== null && (name === '' || catalog.themes.some((theme) => theme.file === name))) {
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
  } else if (op === 'cfg') {
    const dir = u.searchParams.get('plugin');
    const key = u.searchParams.get('key');
    const raw = u.searchParams.get('value');
    if (dir && key && raw !== null && pluginSettingsFile) {
      const plugin = catalog.plugins.find((entry) => entry.dir === dir);
      const def = plugin?.schema.find((entry) => entry.key === key);
      if (def) {
        const value = coerceSetting(def, raw);
        const all = writePluginSetting(pluginSettingsFile, dir, key, value);
        console.log(`[slick-settings] ${dir}.${key} -> ${JSON.stringify(value)}`);
        if (onPluginSetting) {
          try {
            onPluginSetting(dir, key, value, all);
          } catch (e) {
            console.error('[slick-settings] onPluginSetting failed:', e.message);
          }
        }
      }
    }
  } else if (op === 'file') {
    const dir = u.searchParams.get('plugin');
    const key = u.searchParams.get('key');
    const def = catalog.plugins.find((p) => p.dir === dir)?.schema.find((d) => d.key === key && d.type === 'file');
    if (def && onFileSetting && pluginSettingsFile)
      onFileSetting({ dir, key, def })
        .then((value) => {
          if (!value) return;
          const all = writePluginSetting(pluginSettingsFile, dir, key, value);
          console.log(`[slick-settings] ${dir}.${key} -> ${JSON.stringify(value)}`);
          if (onPluginSetting) onPluginSetting(dir, key, value, all);
        })
        .catch((e) => console.error('[slick-settings] file picker failed:', e.message));
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
  readPluginSettings,
  writePluginSetting,
  allPluginSettings,
  listThemes,
  readActiveTheme,
  writeActiveTheme,
};
