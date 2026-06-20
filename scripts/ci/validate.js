'use strict';

const fs = require('fs');
const path = require('path');
const { buildSpec } = require('../theme.js');
const { pluginDirs, settingsSchema, mergeSettings } = require('../byoe/plugins.js');

const ROOT = path.join(__dirname, '..', '..');
const errs = [];
const fail = (f, msg) => errs.push(`${f}: ${msg}`);

const BUILD_SCRIPT = path.join(ROOT, 'scripts/byoe/build-handoff-app.js');
const buildSource = fs.readFileSync(BUILD_SCRIPT, 'utf8');
const injectFile = path.join(ROOT, 'scripts/byoe/inject.js');
const injectSource = fs.readFileSync(injectFile, 'utf8');
for (const match of injectSource.matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)) {
  const dependency = path.relative(ROOT, require.resolve(path.resolve(path.dirname(injectFile), match[1])));
  if (!buildSource.includes(`'${dependency}'`)) {
    fail('scripts/byoe/build-handoff-app.js', `runtime copy list is missing "${dependency}" required by inject.js`);
  }
}

try {
  const internals = require('../byoe/internals');
  if (typeof internals.enabled !== 'function') fail('scripts/byoe/internals', 'must export enabled() function');
  if (typeof internals.source !== 'string' || !internals.source) {
    fail('scripts/byoe/internals', 'must export a non-empty source string');
  } else {
    try {
      const parsed = new Function(internals.source);
      if (typeof parsed !== 'function') fail('scripts/byoe/internals', 'source did not compile');
    } catch (e) {
      fail('scripts/byoe/internals', `source is not valid JS: ${e.message}`);
    }
  }
} catch (e) {
  fail('scripts/byoe/internals', `failed to load: ${e.message}`);
}

const THEMES = path.join(ROOT, 'themes');
const themes = fs.readdirSync(THEMES).filter((f) => f.endsWith('.json'));
for (const f of themes) {
  const p = path.join(THEMES, f);
  let t;
  try {
    t = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail(f, `invalid JSON: ${e.message}`);
    continue;
  }

  if (!t.name || typeof t.name !== 'string') fail(f, '"name" must be a non-empty string');
  for (const [ramp, shades] of Object.entries(t.palette || {}))
    for (const [shade, v] of Object.entries(shades))
      if (!/^\d{1,3},\d{1,3},\d{1,3}$/.test(String(v)))
        fail(f, `palette.${ramp}.${shade} must be raw "r,g,b", got: ${v}`);
  for (const [k, v] of Object.entries({ ...t.sidebar, ...t.vars }))
    if (typeof v !== 'string') fail(f, `"${k}" must be a string`);
  if (t.css && typeof t.css !== 'string' && !Array.isArray(t.css)) fail(f, '"css" must be a string or array');
  try {
    buildSpec(p);
  } catch (e) {
    fail(f, `buildSpec threw: ${e.message}`);
  }
}

const PLUGINS = path.join(ROOT, 'plugins');
const dirs = pluginDirs(PLUGINS);
for (const d of dirs) {
  let m;
  try {
    m = require(path.join(PLUGINS, d, 'index.js'));
  } catch (e) {
    fail(`plugins/${d}`, `index.js failed to load: ${e.message}`);
    continue;
  }

  for (const k of ['name', 'description']) if (!m.meta?.[k]) fail(`plugins/${d}`, `missing meta.${k}`);
  if (m.capabilities !== undefined) {
    const KNOWN = ['internals'];
    if (!Array.isArray(m.capabilities)) fail(`plugins/${d}`, '"capabilities" must be an array');
    else
      for (const cap of m.capabilities) if (!KNOWN.includes(cap)) fail(`plugins/${d}`, `unknown capability "${cap}"`);
  }
  if (m.main && typeof m.main !== 'function') fail(`plugins/${d}`, '"main" must be a function');
  if (!m.main && !m.css && !m.renderer) fail(`plugins/${d}`, 'exports none of main/css/renderer');

  if (m.settings !== undefined && (typeof m.settings !== 'object' || Array.isArray(m.settings) || !m.settings)) {
    fail(`plugins/${d}`, '"settings" must be an object of { key: definition }');
  }
  const TYPES = ['boolean', 'text', 'number', 'select', 'color'];
  for (const [key, raw] of Object.entries(m.settings || {})) {
    if (raw.restartRequired !== undefined && typeof raw.restartRequired !== 'boolean') {
      fail(`plugins/${d}`, `settings.${key}.restartRequired must be a boolean`);
    }
  }
  for (const def of settingsSchema(m)) {
    const at = `settings.${def.key}`;
    if (!TYPES.includes(def.type)) fail(`plugins/${d}`, `${at}: unknown type "${def.type}"`);
    if (def.type === 'select' && (!def.options || !def.options.length)) {
      fail(`plugins/${d}`, `${at}: select needs a non-empty "options" array`);
    }
    if (def.type === 'select' && def.options && !def.options.some((o) => (o?.value ?? o) === def.default)) {
      fail(`plugins/${d}`, `${at}: default "${def.default}" is not one of options`);
    }
    if (def.type === 'boolean' && typeof def.default !== 'boolean')
      fail(`plugins/${d}`, `${at}: default must be a boolean`);
    if (def.type === 'number' && !Number.isFinite(def.default))
      fail(`plugins/${d}`, `${at}: default must be a finite number`);
    if (def.type === 'color' && !/^#[0-9a-fA-F]{3,8}$/.test(String(def.default))) {
      fail(`plugins/${d}`, `${at}: default must be a #hex color, got: ${def.default}`);
    }
    if (def.type === 'text' && typeof def.default !== 'string') fail(`plugins/${d}`, `${at}: default must be a string`);
  }
  if (typeof m.css === 'function') {
    try {
      const css = m.css(mergeSettings(settingsSchema(m)));
      if (typeof css !== 'string') fail(`plugins/${d}`, 'css(settings) must return a string');
    } catch (e) {
      fail(`plugins/${d}`, `css(settings) threw with defaults: ${e.message}`);
    }
  } else if (m.css !== undefined && typeof m.css !== 'string') {
    fail(`plugins/${d}`, '"css" must be a string or a function of settings');
  }
}

try {
  const list = JSON.parse(fs.readFileSync(path.join(PLUGINS, 'enabled.json'), 'utf8'));
  if (!Array.isArray(list)) fail('plugins/enabled.json', 'must be an array');
  else for (const n of list) if (!dirs.includes(n)) fail('plugins/enabled.json', `unknown plugin "${n}"`);
} catch (e) {
  fail('plugins/enabled.json', e.message);
}

if (errs.length) {
  console.error(errs.join('\n'));
  process.exit(1);
}
console.log(`ok: ${themes.length} themes, ${dirs.length} plugins`);
