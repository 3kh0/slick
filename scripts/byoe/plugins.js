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
    restartRequired: d.restartRequired === true,
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

function themeCatalog(themesDir) {
  if (!themesDir) return [];
  let files = [];
  try {
    files = fs.readdirSync(themesDir).filter((file) => file.endsWith('.json') && !file.startsWith('.'));
  } catch {}
  return files.map((filename) => {
    const file = filename.replace(/\.json$/, '');
    let theme = {};
    try {
      theme = JSON.parse(fs.readFileSync(path.join(themesDir, filename), 'utf8'));
    } catch {}
    return { file, label: theme.name || file, description: theme.description || '' };
  });
}

function buildCatalog({ pluginsDir, themesDir }) {
  const plugins = pluginDirs(pluginsDir).map((dir) => {
    try {
      const mod = require(path.join(pluginsDir, dir, 'index.js'));
      return { dir, mod, meta: mod.meta || {}, schema: settingsSchema(mod), error: null };
    } catch (error) {
      return {
        dir,
        mod: null,
        meta: { description: `(failed to load: ${error.message})` },
        schema: [],
        error,
      };
    }
  });
  return { plugins, themes: themeCatalog(themesDir) };
}

function allPluginSettings(catalog, stored) {
  const out = {};
  for (const plugin of catalog.plugins) {
    if (plugin.schema.length) out[plugin.dir] = mergeSettings(plugin.schema, (stored || {})[plugin.dir]);
  }
  return out;
}

function discover(catalog, enabled) {
  const env = (process.env.SLICK_PLUGINS || '').trim();
  if (env)
    return env
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  if (Array.isArray(enabled)) return enabled;
  return catalog.plugins.map(({ dir }) => dir);
}

function loadPlugins({ catalog, enabled, electron, settings }) {
  const out = { block: [], requests: [], css: [], cssFns: [], js: [], windowHooks: [], loaded: [], timings: [] };
  const byDir = new Map(catalog.plugins.map((plugin) => [plugin.dir, plugin]));

  for (const name of discover(catalog, enabled)) {
    const start = performance.now();
    const plugin = byDir.get(name);
    if (!plugin || !plugin.mod) {
      const reason = plugin?.error?.message || 'plugin not found';
      console.error(`[plugins] failed to load "${name}": ${reason}`);
      continue;
    }
    const { mod, schema } = plugin;
    const ctx = {
      name,
      electron,
      settings: mergeSettings(schema, (settings || {})[name]),
      app: electron.app,
      log: (...a) => console.log(`[plugin:${name}]`, ...a),
      blockURLs: (pats) => out.block.push(...[].concat(pats)),
      interceptRequests: (pats, handler) => {
        const urls = [].concat(pats).filter(Boolean);
        if (urls.length && typeof handler === 'function') out.requests.push({ name, urls, handler });
      },
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
    out.timings.push({ name, ms: performance.now() - start });
  }

  return out;
}

module.exports = {
  allPluginSettings,
  buildCatalog,
  coerceSetting,
  loadPlugins,
  mergeSettings,
  pluginDirs,
  settingsSchema,
};
