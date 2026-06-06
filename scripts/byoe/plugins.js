'use strict';

const fs = require('fs');
const path = require('path');

function pluginDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'index.js')))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function settingsSchema(mod) {
  const defs = mod && mod.settings;
  if (!defs || typeof defs !== 'object') return [];
  return Object.entries(defs).map(([key, d]) => ({
    key,
    type: d.type || 'text',
    label: d.label || key,
    description: d.description || '',
    default: d.default !== undefined ? d.default : d.type === 'boolean' ? false : '',
    options: Array.isArray(d.options) ? d.options : undefined,
  }));
}

function mergeSettings(schema, stored) {
  const out = {};
  for (const def of schema) {
    out[def.key] = stored && stored[def.key] !== undefined ? stored[def.key] : def.default;
  }
  return out;
}

function coerceSetting(def, raw) {
  if (def.type === 'boolean') return raw === '1' || raw === 'true';
  if (def.type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : def.default;
  }
  if (def.type === 'color') return /^#[0-9a-fA-F]{3,8}$/.test(raw) ? raw : def.default;
  if (def.type === 'select' && def.options && !def.options.some((o) => String(o.value ?? o) === raw)) {
    return def.default;
  }
  return raw;
}

function discover(dir, enabled) {
  const env = (process.env.SLICK_PLUGINS || '').trim();
  if (env)
    return env
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  if (Array.isArray(enabled)) return enabled;
  try {
    const list = JSON.parse(fs.readFileSync(path.join(dir, 'enabled.json'), 'utf8'));
    if (Array.isArray(list)) return list;
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[plugins] enabled.json invalid:', e.message);
  }
  return pluginDirs(dir);
}

function loadPlugins({ pluginsDir, enabled, electron, settings }) {
  const out = { block: [], css: [], cssFns: [], js: [], windowHooks: [], loaded: [] };

  for (const name of discover(pluginsDir, enabled)) {
    let mod;
    try {
      mod = require(path.join(pluginsDir, name, 'index.js'));
    } catch (e) {
      console.error(`[plugins] failed to load "${name}": ${e.message}`);
      continue;
    }

    const schema = settingsSchema(mod);
    const ctx = {
      name,
      electron,
      settings: mergeSettings(schema, (settings || {})[name]),
      app: electron.app,
      log: (...a) => console.log(`[plugin:${name}]`, ...a),
      blockURLs: (pats) => out.block.push(...[].concat(pats)),
      injectCSS: (css) => out.css.push([].concat(css).join('\n')),
      injectJS: (js) => {
        if (js) out.js.push(String(js));
      },
      onWindow: (cb) => {
        if (typeof cb === 'function') out.windowHooks.push(cb);
      },
    };

    if (typeof mod.css === 'function') out.cssFns.push({ name, schema, fn: mod.css });
    else if (mod.css) ctx.injectCSS(mod.css);
    if (mod.renderer) ctx.injectJS(mod.renderer);
    if (typeof mod.main === 'function') {
      try {
        mod.main(ctx);
      } catch (e) {
        ctx.log('main() threw:', e.message);
      }
    }
    out.loaded.push((mod.meta && mod.meta.name) || name);
  }

  return out;
}

module.exports = { loadPlugins, pluginDirs, settingsSchema, mergeSettings, coerceSetting };
