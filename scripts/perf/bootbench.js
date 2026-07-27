#!/usr/bin/env node
'use strict';

// Fixture-free boot-path benchmark.
//
// The CDP benchmark needs an authenticated Slack fixture profile, which makes it
// a poor loop for iterating on main-process boot cost. This times the same work
// in plain Node — no Slack, no Electron, no account — so a before/after takes
// seconds and runs on any machine.
//
//   node scripts/perf/bootbench.js [--iterations 15] [--output work/perf-bootbench.json]
//   node scripts/perf/bootbench.js --compare work/perf-bootbench-baseline.json

const fs = require('fs');
const os = require('os');
const path = require('path');
const { percentile, summarize } = require('./analyze');

const ROOT = path.resolve(__dirname, '..', '..');
const PLUGINS_DIR = path.join(ROOT, 'plugins');
const THEMES_DIR = path.join(ROOT, 'themes');
const BYOE_DIR = path.join(ROOT, 'scripts', 'byoe');

// diagnostics.js reads process.resourcesPath to find Slack's version file. It is
// an Electron-only global, and slackVersion() builds its candidate paths before
// entering its try block, so it throws outright under plain Node.
if (!process.resourcesPath) process.resourcesPath = path.join(os.tmpdir(), 'slick-bootbench-resources');

// Plugin main() implementations log on load; the bench calls them repeatedly.
function quietly(fn) {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

function usage() {
  console.log(`Usage:
  node scripts/perf/bootbench.js [options]

Options:
  --iterations <n>       Measured iterations (default: 15)
  --warmup <n>           Unmeasured warmup iterations (default: 3)
  --output <file>        Result JSON (default: work/perf-bootbench.json)
  --compare <file>       Also print a delta against an earlier result
  --json                 Print the result JSON instead of the table

Times Slick's main-process boot work in isolation. No Slack install, Electron
runtime, or signed-in profile is required.`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_m, letter) => letter.toUpperCase());
      out[key] = argv[++i];
    } else throw new Error(`Unexpected argument: ${arg}`);
  }
  return out;
}

// Slick's boot cost is dominated by first-read work, so every iteration has to
// start from a cold require cache for the modules under test.
function purgeCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(PLUGINS_DIR + path.sep) || key.startsWith(BYOE_DIR + path.sep)) delete require.cache[key];
  }
}

function time(fn) {
  const started = performance.now();
  const value = fn();
  return { ms: performance.now() - started, value };
}

async function timeAsync(fn) {
  const started = performance.now();
  await fn();
  return performance.now() - started;
}

function directorySize(dir, filename) {
  let total = 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      total += fs.statSync(path.join(dir, entry.name, filename)).size;
      count++;
    } catch {}
  }
  return { bytes: total, count };
}

function facts() {
  const renderer = directorySize(PLUGINS_DIR, 'renderer.js');
  const index = directorySize(PLUGINS_DIR, 'index.js');
  let themeCount = 0;
  let themeBytes = 0;
  try {
    for (const file of fs.readdirSync(THEMES_DIR)) {
      if (!file.endsWith('.json') || file.startsWith('.')) continue;
      themeCount++;
      themeBytes += fs.statSync(path.join(THEMES_DIR, file)).size;
    }
  } catch {}
  let defaultEnabled = [];
  try {
    defaultEnabled = JSON.parse(fs.readFileSync(path.join(PLUGINS_DIR, 'enabled.json'), 'utf8'));
  } catch {}
  return {
    pluginCount: index.count,
    rendererBytes: renderer.bytes,
    indexBytes: index.bytes,
    themeCount,
    themeBytes,
    defaultEnabled,
  };
}

// A session shaped like the real recorder's output, so persist() is timed
// against a payload the size it actually reaches in the field.
function syntheticSession(sampleCount) {
  const processes = Array.from({ length: 8 }, (_unused, index) => ({
    type: index === 0 ? 'Browser' : 'Tab',
    cpuPercent: 1.25,
    idleWakeups: 12,
    workingSetKb: 180000,
    privateKb: 140000,
  }));
  return {
    schemaVersion: 1,
    id: '0-0',
    startedAt: new Date(0).toISOString(),
    endedAt: new Date(0).toISOString(),
    system: { platform: process.platform, arch: process.arch, cpus: os.cpus().length },
    enabledPlugins: ['NoTrack', 'Snappy'],
    theme: '',
    boot: null,
    events: [],
    samples: Array.from({ length: sampleCount }, (_unused, index) => ({
      atMs: index * 15000,
      processes,
      renderer: [
        {
          windowId: 1,
          hidden: false,
          longTasks: { count: 12, totalMs: 640, maxMs: 120 },
          events: { count: 40, totalMs: 900, maxMs: 80, byType: { click: { count: 8, totalMs: 200, maxMs: 60 } } },
          stalls: { count: 1, totalMs: 300, maxMs: 300 },
          dom: null,
        },
      ],
    })),
    renderer: [],
    network: { total: 0, failed: 0, blocked: 0, byType: {} },
  };
}

function stubElectron() {
  const noop = () => {};
  return {
    app: { getVersion: () => '1.0.0', getPath: () => os.tmpdir(), on: noop },
    session: { defaultSession: { webRequest: {} } },
    ipcMain: { on: noop, handle: noop },
    dialog: {},
  };
}

// Each phase returns the milliseconds it took; the runner collects one value per iteration.
function phases() {
  return {
    'plugins.js module load': () => {
      purgeCache();
      return time(() => require('../byoe/plugins')).ms;
    },

    'buildCatalog (all plugins)': () => {
      purgeCache();
      const { buildCatalog } = require('../byoe/plugins');
      return time(() => buildCatalog({ pluginsDir: PLUGINS_DIR, themesDir: THEMES_DIR })).ms;
    },

    'buildCatalog (enabled only)': () => {
      purgeCache();
      const { buildCatalog } = require('../byoe/plugins');
      const enabled = facts().defaultEnabled;
      // Falls back to the eager call on a tree that predates the `only` option,
      // so a baseline captured before the change is still comparable.
      return time(() => buildCatalog({ pluginsDir: PLUGINS_DIR, themesDir: THEMES_DIR, only: enabled })).ms;
    },

    themeCatalog: () => {
      purgeCache();
      const plugins = require('../byoe/plugins');
      if (typeof plugins.themeCatalog !== 'function') return null;
      return time(() => plugins.themeCatalog(THEMES_DIR)).ms;
    },

    'loadPlugins (defaults)': () => {
      purgeCache();
      const { buildCatalog, loadPlugins } = require('../byoe/plugins');
      const enabled = facts().defaultEnabled;
      const catalog = buildCatalog({ pluginsDir: PLUGINS_DIR, themesDir: THEMES_DIR, only: enabled });
      return quietly(() => time(() => loadPlugins({ catalog, enabled, electron: stubElectron(), settings: {} })).ms);
    },

    'settings-ui.js module load': () => {
      purgeCache();
      return time(() => require('../byoe/settings-ui')).ms;
    },

    'theme buildSpec': () => {
      purgeCache();
      const { buildSpec } = require('../theme');
      const file = fs
        .readdirSync(THEMES_DIR)
        .filter((name) => name.endsWith('.json'))
        .map((name) => path.join(THEMES_DIR, name))[0];
      if (!file) return null;
      return time(() => buildSpec(file)).ms;
    },

    'diagnostics.create (10 stored sessions)': () => {
      purgeCache();
      return withSeededSessions(9, (dir) => time(() => newSession(dir)).ms);
    },

    // The first write also pays the deferred load of the earlier sessions.
    'diagnostics persist (first write)': () => {
      purgeCache();
      return withSeededSessions(9, async (dir) => {
        const session = newSession(dir);
        return timeAsync(() => session.persist());
      });
    },

    // What the 60s timer actually costs once the process is warm — the number
    // that matters, since it repeats for the life of the app.
    'diagnostics persist (steady state)': () => {
      purgeCache();
      return withSeededSessions(9, async (dir) => {
        const session = newSession(dir);
        await session.persist();
        return timeAsync(() => session.persist());
      });
    },
  };
}

function newSession(dir) {
  const diagnostics = require('../byoe/diagnostics');
  return diagnostics.create({
    app: stubElectron().app,
    electron: stubElectron(),
    settingsDir: dir,
    enabledPlugins: ['NoTrack', 'Snappy'],
    activeTheme: '',
  });
}

async function withSeededSessions(count, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-bootbench-'));
  try {
    const sessions = Array.from({ length: count }, () => syntheticSession(720));
    fs.writeFileSync(path.join(dir, 'performance-sessions.json'), JSON.stringify(sessions));
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function perPluginCost() {
  const names = fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(PLUGINS_DIR, entry.name, 'index.js')))
    .map((entry) => entry.name);
  const rows = [];
  for (const name of names) {
    purgeCache();
    const entry = path.join(PLUGINS_DIR, name, 'index.js');
    let ms = 0;
    let error = null;
    try {
      ms = time(() => require(entry)).ms;
    } catch (failure) {
      error = failure.message;
    }
    let bytes = 0;
    for (const file of ['index.js', 'renderer.js']) {
      try {
        bytes += fs.statSync(path.join(PLUGINS_DIR, name, file)).size;
      } catch {}
    }
    rows.push({ name, ms: Math.round(ms * 1000) / 1000, bytes, error });
  }
  return rows.toSorted((a, b) => b.ms - a.ms);
}

async function run(options) {
  const iterations = Math.max(1, Number(options.iterations || 15));
  const warmup = Math.max(0, Number(options.warmup ?? 3));
  const definitions = phases();
  const collected = new Map(Object.keys(definitions).map((name) => [name, []]));

  for (let index = 0; index < warmup + iterations; index++) {
    for (const [name, fn] of Object.entries(definitions)) {
      let ms = null;
      try {
        ms = await fn();
      } catch (error) {
        if (index === 0) console.warn(`  ${name}: ${error.message}`);
      }
      if (index >= warmup && Number.isFinite(ms)) collected.get(name).push(ms);
    }
  }

  const summary = {};
  for (const [name, values] of collected) {
    if (!values.length) continue;
    const stats = summarize(values);
    summary[name] = {
      count: stats.count,
      p50: Math.round(stats.p50 * 1000) / 1000,
      p95: Math.round(percentile(values, 0.95) * 1000) / 1000,
      mean: Math.round(stats.mean * 1000) / 1000,
      min: Math.round(stats.min * 1000) / 1000,
      max: Math.round(stats.max * 1000) / 1000,
    };
  }

  const cpu = os.cpus()[0];
  return {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    cpuModel: cpu ? cpu.model : '',
    cpus: os.cpus().length,
    memoryMb: Math.round(os.totalmem() / 1024 / 1024),
    nodeVersion: process.versions.node,
    iterations,
    warmup,
    facts: facts(),
    phases: summary,
    plugins: perPluginCost(),
  };
}

function formatMs(value) {
  return `${value.toFixed(2)}ms`;
}

function format(result, baseline) {
  const lines = [
    `Slick boot bench — ${result.platform}/${result.arch}, node ${result.nodeVersion}, ${result.iterations} iterations`,
    `${result.facts.pluginCount} plugins (${Math.round((result.facts.indexBytes + result.facts.rendererBytes) / 1024)} KB of index+renderer), ` +
      `${result.facts.themeCount} themes, default enabled: ${result.facts.defaultEnabled.join(', ') || 'none'}`,
    '',
  ];
  const width = Math.max(...Object.keys(result.phases).map((name) => name.length));
  for (const [name, stats] of Object.entries(result.phases)) {
    let line = `${name.padEnd(width)}  p50 ${formatMs(stats.p50).padStart(9)}  p95 ${formatMs(stats.p95).padStart(9)}`;
    const before = baseline?.phases?.[name];
    if (before) {
      const delta = stats.p50 - before.p50;
      const percent = before.p50 ? (delta / before.p50) * 100 : 0;
      const sign = delta > 0 ? '+' : '';
      line += `   was ${formatMs(before.p50)}  (${sign}${delta.toFixed(2)}ms, ${sign}${percent.toFixed(0)}%)`;
    }
    lines.push(line);
  }
  const slowest = result.plugins.filter((row) => row.ms > 0).slice(0, 8);
  if (slowest.length) {
    lines.push('', 'slowest plugin requires (cold cache, single read):');
    for (const row of slowest) {
      lines.push(`  ${row.name.padEnd(24)} ${formatMs(row.ms).padStart(9)}  ${Math.round(row.bytes / 1024)} KB`);
    }
  }
  const failed = result.plugins.filter((row) => row.error);
  if (failed.length) {
    lines.push('', `plugins that failed to require: ${failed.map((row) => row.name).join(', ')}`);
  }
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return usage();
  let baseline = null;
  if (options.compare) {
    try {
      baseline = JSON.parse(fs.readFileSync(path.resolve(options.compare), 'utf8'));
    } catch (error) {
      console.warn(`Could not read baseline ${options.compare}: ${error.message}`);
    }
  }
  const result = await run(options);
  const output = path.resolve(options.output || path.join(ROOT, 'work/perf-bootbench.json'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(format(result, baseline));
  console.log(`\nResults: ${output}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { facts, perPluginCost, run, syntheticSession };
