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

function loadPlugins({ pluginsDir, enabled, electron }) {
  const out = { block: [], css: [], js: [], windowHooks: [], loaded: [] };

  for (const name of discover(pluginsDir, enabled)) {
    let mod;
    try {
      mod = require(path.join(pluginsDir, name, 'index.js'));
    } catch (e) {
      console.error(`[plugins] failed to load "${name}": ${e.message}`);
      continue;
    }

    const ctx = {
      name,
      electron,
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

    if (mod.css) ctx.injectCSS(mod.css);
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

module.exports = { loadPlugins, pluginDirs };
