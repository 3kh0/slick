#!/usr/bin/env node
'use strict';

const { execFileSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { analyze, format } = require('./analyze');
const { rendererProbeSource } = require('../byoe/diagnostics');

const ROOT = path.resolve(__dirname, '..', '..');
const PLUGINS = path.join(ROOT, 'plugins');
const WORKSPACE_SELECTOR = '.p-client_workspace, .p-workspace__primary_view';

function usage() {
  console.log(`Usage:
  node scripts/perf/benchmark.js run --profile <fixture-profile> [options]
  node scripts/perf/benchmark.js matrix --profile <fixture-profile> [options]
  node scripts/perf/benchmark.js bisect --diagnostics <export.json> --profile <fixture-profile> [options]

Options:
  --variant stock|core|defaults|plugin:Name|plugins:A,B
  --runs <n>                 Warm runs (default: 1 for run; 20 stock/core/defaults in matrix)
  --cold-runs <n>            Cold-cache cloned runs (default: 0; matrix default: 10 for stock/core/defaults)
  --output <file>            Result JSON (default: work/perf-results.json)
  --stock-executable <path>  Override detected stock Slack executable
  --slick-executable <path>  Override detected Slick executable
  --idle-seconds <n>         Foreground observation after journey (default: 16)
  --background-seconds <n>   Minimized/occluded observation period
  --soak-minutes <n>         Repeat the read-only journey during a soak
  --disable-switch <name>    Omit a Slick Chromium switch; repeatable
  --disable-gpu              Launch Slick with hardware acceleration disabled
  --enforce                  Exit unsuccessfully on budgets or missing release platforms
  --port <n>                 First CDP port (default: 9323)

The fixture profile is only read and cloned. Every run uses a new temporary profile.`);
}

function parseArgs(argv) {
  const command = argv.shift() || 'run';
  const out = { command, disableSwitches: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--disable-gpu') out.disableGpu = true;
    else if (arg === '--enforce') out.enforce = true;
    else if (arg === '--disable-switch') out.disableSwitches.push(argv[++i]);
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_m, letter) => letter.toUpperCase());
      out[key] = argv[++i];
    } else throw new Error(`Unexpected argument: ${arg}`);
  }
  return out;
}

function pluginNames() {
  return fs
    .readdirSync(PLUGINS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(PLUGINS, entry.name, 'index.js')))
    .map((entry) => entry.name)
    .toSorted();
}

function variantsForMatrix() {
  return ['stock', 'core', 'defaults', ...pluginNames().map((name) => `plugin:${name}`)];
}

function executableDefaults() {
  if (process.platform === 'darwin') {
    return {
      stock: '/Applications/Slack.app/Contents/MacOS/Slack',
      slick: path.join(os.homedir(), 'Applications/Slick.app/Contents/MacOS/Electron'),
    };
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    let stock = '';
    try {
      const dirs = fs
        .readdirSync(path.join(local, 'slack'))
        .filter((name) => /^app-\d/.test(name))
        .toSorted()
        .toReversed();
      stock = dirs.map((name) => path.join(local, 'slack', name, 'slack.exe')).find(fs.existsSync) || '';
    } catch {}
    return { stock, slick: path.join(local, 'Slick', 'Slick.exe') };
  }
  return {
    stock: process.env.SLICK_STOCK_SLACK || '/usr/bin/slack',
    slick: path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'slick/app/electron'),
  };
}

function ensureFixture(profile) {
  const resolved = path.resolve(profile || '');
  if (!profile || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('--profile must point to a dedicated, authenticated fixture profile directory');
  }
  return resolved;
}

function cloneProfile(fixture) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-perf-'));
  const profile = path.join(parent, 'profile');
  fs.cpSync(fixture, profile, { recursive: true, preserveTimestamps: true });
  return { parent, profile };
}

function removeCaches(profile) {
  const names = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'GrShaderCache']);
  const visit = (dir, depth) => {
    if (depth > 5) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      if (names.has(entry.name)) fs.rmSync(target, { recursive: true, force: true });
      else visit(target, depth + 1);
    }
  };
  visit(profile, 0);
}

function configureVariant(profile, variant) {
  if (variant === 'stock') return [];
  const settings = path.join(profile, 'slick');
  fs.mkdirSync(settings, { recursive: true });
  let enabled;
  if (variant === 'core') enabled = [];
  else if (variant === 'defaults') enabled = ['NoTrack', 'Snappy'];
  else if (variant.startsWith('plugin:')) enabled = [variant.slice('plugin:'.length)];
  else if (variant.startsWith('plugins:')) enabled = variant.slice('plugins:'.length).split(',').filter(Boolean);
  else throw new Error(`Unknown variant: ${variant}`);
  for (const name of enabled) {
    if (!fs.existsSync(path.join(PLUGINS, name, 'index.js'))) throw new Error(`Unknown plugin: ${name}`);
  }
  fs.writeFileSync(path.join(settings, 'enabled-plugins.json'), JSON.stringify(enabled, null, 2) + '\n');
  fs.writeFileSync(path.join(settings, 'active-theme'), '\n');
  return enabled;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(1000, () => req.destroy(new Error('CDP endpoint timed out')));
  });
}

async function waitForTarget(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
      const target =
        targets.find((item) => /app\.slack\.com\/client/.test(item.url)) ||
        targets.find((item) => item.type === 'page' && /slack/i.test(`${item.title} ${item.url}`));
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No Slack CDP page appeared on port ${port} within ${timeoutMs}ms`);
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        this.events.push(message);
        if (this.events.length > 200) this.events.shift();
        return;
      }
      if (!this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    await this.send('Runtime.enable');
    await this.send('Performance.enable');
    await this.send('Network.enable');
    await this.send('Page.enable');
    return this;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = true) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
    return result.result.value;
  }

  close() {
    this.socket?.close();
  }
}

async function waitForWorkspace(cdp, timeoutMs = 120000) {
  return cdp.evaluate(`new Promise((resolve, reject) => {
    const started = performance.now();
    const selector = ${JSON.stringify(WORKSPACE_SELECTOR)};
    const ready = () => {
      if (!document.querySelector(selector)) return false;
      resolve({ pageMs: Math.round(performance.now()), waitMs: Math.round(performance.now() - started) });
      return true;
    };
    if (ready()) return;
    const observer = new MutationObserver(() => {
      if (ready()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error('workspace timeout')); }, ${timeoutMs});
  })`);
}

async function action(cdp, name, body) {
  return cdp.evaluate(`(async () => {
    const started = performance.now();
    window.__slickPerf?.markAction(${JSON.stringify(name)}, 'start');
    const changed = await (${body})();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const durationMs = performance.now() - started;
    window.__slickPerf?.markAction(${JSON.stringify(name)}, 'end', durationMs);
    return { name: ${JSON.stringify(name)}, changed: !!changed, durationMs: Math.round(durationMs * 100) / 100 };
  })()`);
}

async function readonlyJourney(cdp) {
  const interactions = [];
  interactions.push(
    await action(
      cdp,
      'workspace-switch',
      `async () => {
        const candidates = [...document.querySelectorAll(
          '[data-qa="team_sidebar_team"], [data-qa*="workspace" i][role="button"]'
        )].filter((node) => node.getClientRects().length && node.getAttribute('aria-current') !== 'page');
        if (!candidates[1]) return false;
        candidates[1].click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        return true;
      }`,
    ),
  );
  interactions.push(
    await action(
      cdp,
      'channel-switch',
      `async () => {
        const candidates = [...document.querySelectorAll(
          '[data-qa-channel-sidebar-channel-type], [data-qa="channel_sidebar_name_button"]'
        )].filter((node) => node.getClientRects().length && node.getAttribute('aria-current') !== 'page');
        if (!candidates[1]) return false;
        candidates[1].click();
        await new Promise((resolve) => setTimeout(resolve, 250));
        return true;
      }`,
    ),
  );
  interactions.push(
    await action(
      cdp,
      'open-thread',
      `async () => {
        const reply = [...document.querySelectorAll(
          '[data-qa="reply_count"], [data-qa="message_actions_reply"], button[aria-label*="thread" i]'
        )].find((node) => node.getClientRects().length);
        if (!reply) return false;
        reply.click();
        await new Promise((resolve) => setTimeout(resolve, 250));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
      }`,
    ),
  );
  interactions.push(
    await action(
      cdp,
      'message-scroll',
      `async () => {
        const scroller = document.querySelector(
          '[data-qa="slack_kit_scrollbar"], .c-scrollbar__hider, .p-message_pane .c-scrollbar__hider'
        );
        if (!scroller) return false;
        scroller.scrollBy({ top: 900, behavior: 'instant' });
        await new Promise((resolve) => setTimeout(resolve, 150));
        return true;
      }`,
    ),
  );
  interactions.push(
    await action(
      cdp,
      'composer-type-delete',
      `async () => {
        const editor = [...document.querySelectorAll('[contenteditable="true"][role="textbox"]')]
          .find((node) => node.getClientRects().length);
        if (!editor) return false;
        const before = editor.innerHTML;
        editor.focus();
        document.execCommand('insertText', false, 'slick performance probe');
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        await new Promise((resolve) => setTimeout(resolve, 100));
        document.execCommand('undo');
        if (editor.innerHTML !== before) editor.innerHTML = before;
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
        return true;
      }`,
    ),
  );
  interactions.push(
    await action(
      cdp,
      'open-search',
      `async () => {
        const search = [...document.querySelectorAll(
          '[data-qa="top_nav_search"], button[aria-label*="search" i], [role="button"][aria-label*="search" i]'
        )].find((node) => node.getClientRects().length);
        if (!search) return false;
        search.click();
        await new Promise((resolve) => setTimeout(resolve, 200));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
      }`,
    ),
  );
  interactions.push(
    await action(
      cdp,
      'open-profile',
      `async () => {
        const sender = [...document.querySelectorAll('.c-message__sender_button,[data-qa="message_sender"]')]
          .find((node) => node.getClientRects().length);
        if (!sender) return false;
        sender.click();
        await new Promise((resolve) => setTimeout(resolve, 250));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
      }`,
    ),
  );
  return interactions.filter((item) => item.changed);
}

async function offlineReconnect(cdp) {
  const started = Date.now();
  try {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { name: 'offline-reconnect', changed: true, durationMs: Date.now() - started };
  } catch {
    return { name: 'offline-reconnect', changed: false, durationMs: 0 };
  }
}

async function backgroundObservation(cdp, targetId, seconds, sample) {
  if (!seconds) return;
  try {
    const { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId });
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until) {
      sample();
      await new Promise((resolve) => setTimeout(resolve, Math.min(5000, until - Date.now())));
    }
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  } catch (error) {
    console.warn(`  background observation unavailable: ${error.message}`);
  }
}

function processTreeSample(rootPid) {
  if (process.platform === 'win32') return null;
  try {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,%cpu=,rss='], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter((row) => row.length === 4);
    const ids = new Set([rootPid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [pid, ppid] of rows) {
        if (ids.has(ppid) && !ids.has(pid)) {
          ids.add(pid);
          changed = true;
        }
      }
    }
    const selected = rows.filter(([pid]) => ids.has(pid));
    return {
      cpuPercent: selected.reduce((sum, row) => sum + row[2], 0),
      privateKb: selected.reduce((sum, row) => sum + row[3], 0),
      processCount: selected.length,
    };
  } catch {
    return null;
  }
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
}

function latestDiagnosticSession(profile) {
  try {
    const sessions = JSON.parse(fs.readFileSync(path.join(profile, 'slick', 'performance-sessions.json'), 'utf8'));
    return Array.isArray(sessions) ? sessions.at(-1) : null;
  } catch {
    return null;
  }
}

function launch({ executable, variant, profile, port, options }) {
  if (!executable || !fs.existsSync(executable) || !fs.statSync(executable).isFile()) {
    throw new Error(`Executable not found: ${executable || '(empty)'}`);
  }
  const env = { ...process.env };
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`];
  if (variant !== 'stock') {
    env.SLICK_HANDOFF_PROFILE = profile;
    env.SLICK_PERF_DETAILED = '1';
    if (options.disableSwitches.length) env.SLICK_DISABLE_SWITCHES = options.disableSwitches.join(',');
    if (options.disableGpu) env.SLICK_DISABLE_GPU = '1';
  }
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  return spawn(executable, args, {
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

async function runOnce(options, variant, cold, sequence) {
  const fixture = ensureFixture(options.profile);
  const { parent, profile } = cloneProfile(fixture);
  const enabledPlugins = configureVariant(profile, variant);
  if (cold) removeCaches(profile);
  const defaults = executableDefaults();
  const executable =
    variant === 'stock'
      ? path.resolve(options.stockExecutable || defaults.stock)
      : path.resolve(options.slickExecutable || defaults.slick);
  const port = Number(options.port || 9323) + sequence;
  const launchedAt = Date.now();
  const child = launch({ executable, variant, profile, port, options });
  let cdp;
  const processSamples = [];
  try {
    const target = await waitForTarget(port);
    cdp = await new Cdp(target.webSocketDebuggerUrl).connect();
    await cdp.evaluate(rendererProbeSource(true));
    const workspace = await waitForWorkspace(cdp);
    const startupMs = Date.now() - launchedAt;
    const interactions = await readonlyJourney(cdp);
    interactions.push(await offlineReconnect(cdp));
    const idleSeconds = Math.max(0, Number(options.idleSeconds ?? 16));
    const soakMinutes = Math.max(0, Number(options.soakMinutes || 0));
    const until = Date.now() + Math.max(idleSeconds * 1000, soakMinutes * 60000);
    let nextJourney = Date.now() + 60000;
    while (Date.now() < until) {
      const sample = processTreeSample(child.pid);
      if (sample) processSamples.push({ atMs: Date.now() - launchedAt, ...sample });
      if (soakMinutes && Date.now() >= nextJourney) {
        interactions.push(...(await readonlyJourney(cdp)));
        nextJourney += 60000;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(5000, Math.max(0, until - Date.now()))));
    }
    const backgroundSeconds = Math.max(0, Number(options.backgroundSeconds || 0));
    await backgroundObservation(cdp, target.id, backgroundSeconds, () => {
      const sample = processTreeSample(child.pid);
      if (sample) processSamples.push({ atMs: Date.now() - launchedAt, background: true, ...sample });
    });
    const renderer = await cdp.evaluate(
      'window.__slickPerf?.snapshot ? window.__slickPerf.snapshot() : ({ longTasks: null, dom: null })',
    );
    const diagnostic = latestDiagnosticSession(profile);
    const diagnosticEvents = diagnostic?.events || [];
    const crashes =
      diagnosticEvents.filter((event) => event.type === 'render-process-gone').length +
      cdp.events.filter((event) => event.method === 'Inspector.targetCrashed').length;
    const hangs = diagnosticEvents.filter((event) => event.type === 'renderer-unresponsive').length;
    return {
      schemaVersion: 1,
      platform: process.platform,
      arch: process.arch,
      variant,
      enabledPlugins,
      cold,
      startupMs,
      workspaceReadyMs: workspace.pageMs,
      interactions,
      processSamples,
      renderer,
      crashes,
      hangs,
      options: {
        disableSwitches: options.disableSwitches,
        disableGpu: !!options.disableGpu,
        idleSeconds,
        backgroundSeconds,
        soakMinutes,
      },
      recordedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      platform: process.platform,
      arch: process.arch,
      variant,
      enabledPlugins,
      cold,
      error: error.message,
      crashes: child.exitCode && child.exitCode !== 0 ? 1 : 0,
      hangs: /timeout/i.test(error.message) ? 1 : 0,
      recordedAt: new Date().toISOString(),
    };
  } finally {
    cdp?.close();
    stopProcess(child);
    await new Promise((resolve) => setTimeout(resolve, 500));
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

function readOutput(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(value.runs) ? value : { schemaVersion: 1, runs: [] };
  } catch {
    return { schemaVersion: 1, runs: [] };
  }
}

function writeOutput(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
}

async function runVariants(options, variants, counts) {
  const output = path.resolve(options.output || path.join(ROOT, 'work/perf-results.json'));
  const payload = readOutput(output);
  const queue = [];
  for (const variant of variants) {
    for (let index = 0; index < counts.cold(variant); index++) queue.push({ variant, cold: true });
    for (let index = 0; index < counts.warm(variant); index++) queue.push({ variant, cold: false });
  }
  queue.sort(() => Math.random() - 0.5);
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    console.log(`[${index + 1}/${queue.length}] ${item.variant} ${item.cold ? 'cold' : 'warm'}`);
    const result = await runOnce(options, item.variant, item.cold, payload.runs.length + index);
    payload.runs.push(result);
    writeOutput(output, payload);
    console.log(result.error ? `  ERROR ${result.error}` : `  ${result.startupMs}ms startup`);
  }
  const report = analyze(payload, { enforce: !!options.enforce });
  fs.writeFileSync(output.replace(/\.json$/i, '.report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(format(report));
  console.log(`Results: ${output}`);
}

async function bisect(options) {
  if (!options.diagnostics) throw new Error('bisect requires --diagnostics <export.json>');
  const bundle = JSON.parse(fs.readFileSync(path.resolve(options.diagnostics), 'utf8'));
  const sessions = bundle.sessions || [];
  const plugins = sessions.at(-1)?.enabledPlugins || [];
  if (plugins.length < 2) throw new Error('The diagnostic bundle must contain at least two enabled plugins');
  const variants = ['core'];
  let groups = [plugins];
  while (groups.some((group) => group.length > 1)) {
    const next = [];
    for (const group of groups) {
      if (group.length === 1) {
        next.push(group);
        continue;
      }
      const middle = Math.ceil(group.length / 2);
      next.push(group.slice(0, middle), group.slice(middle));
    }
    variants.push(...next.map((group) => `plugins:${group.join(',')}`));
    groups = next;
  }
  await runVariants(options, [...new Set(variants)], {
    cold: () => 0,
    warm: () => Math.max(1, Number(options.runs || 3)),
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !['run', 'matrix', 'bisect'].includes(options.command)) return usage();
  ensureFixture(options.profile);
  if (options.command === 'bisect') return bisect(options);
  if (options.command === 'run') {
    const variant = options.variant || 'defaults';
    return runVariants(options, [variant], {
      cold: () => Math.max(0, Number(options.coldRuns || 0)),
      warm: () => Math.max(1, Number(options.runs || 1)),
    });
  }
  await runVariants(options, variantsForMatrix(), {
    cold: (variant) =>
      ['stock', 'core', 'defaults'].includes(variant) ? Math.max(0, Number(options.coldRuns ?? 10)) : 0,
    warm: (variant) =>
      ['stock', 'core', 'defaults'].includes(variant)
        ? Math.max(1, Number(options.runs ?? 20))
        : Math.max(1, Number(options.pluginRuns ?? 5)),
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { configureVariant, executableDefaults, pluginNames, removeCaches, variantsForMatrix };
