'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCHEMA_VERSION = 1;
const MAX_SESSIONS = 10;
const MAX_EVENTS = 240;
const MAX_SAMPLES = 720;
const SAMPLE_MS = 15000;
const WRITE_MS = 60000;
const ID_RE = /\b[BCDEFGHJKMNPQRTUWXYZ][A-Z0-9]{8,}\b/g;
const TOKEN_RE = /\b(?:xox[a-z]-[A-Za-z0-9-]+|Bearer\s+\S+)\b/gi;
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

function finite(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function redactString(value) {
  return String(value == null ? '' : value)
    .replace(URL_RE, (raw) => {
      try {
        return `${new URL(raw).protocol}//${new URL(raw).hostname}/[redacted]`;
      } catch {
        return '[redacted-url]';
      }
    })
    .replace(TOKEN_RE, '[redacted-token]')
    .replace(ID_RE, '[redacted-id]')
    .slice(0, 500);
}

function sanitize(value, depth = 0) {
  if (depth > 6 || value == null) return value == null ? null : '[truncated]';
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number') return finite(value);
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    if (
      /(?:^|_)(?:token|cookie|authorization)(?:_|$)/.test(normalized) ||
      ['message', 'message_text', 'text', 'content', 'filename', 'file_path', 'custom_css', 'setting_value'].includes(
        normalized,
      )
    ) {
      continue;
    }
    out[key] = sanitize(child, depth + 1);
  }
  return out;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function boundedPush(array, value, max) {
  array.push(value);
  if (array.length > max) array.splice(0, array.length - max);
}

function rendererProbeSource(detailed) {
  return `(() => {
    if (window.__slickPerf) {
      window.__slickPerf.detailed = window.__slickPerf.detailed || ${detailed ? 'true' : 'false'};
      return;
    }
    const state = {
      version: ${SCHEMA_VERSION},
      detailed: ${detailed ? 'true' : 'false'},
      startedAt: Date.now(),
      longTasks: { count: 0, totalMs: 0, maxMs: 0 },
      events: { count: 0, totalMs: 0, maxMs: 0, byType: {} },
      stalls: { count: 0, totalMs: 0, maxMs: 0 },
      navigations: [],
      actions: [],
    };
    const cap = (array, value, max) => {
      array.push(value);
      if (array.length > max) array.splice(0, array.length - max);
    };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.count++;
          state.longTasks.totalMs += entry.duration;
          state.longTasks.maxMs = Math.max(state.longTasks.maxMs, entry.duration);
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = entry.duration || 0;
          state.events.count++;
          state.events.totalMs += duration;
          state.events.maxMs = Math.max(state.events.maxMs, duration);
          const name = String(entry.name || 'unknown').slice(0, 40);
          const item = state.events.byType[name] || (state.events.byType[name] = { count: 0, totalMs: 0, maxMs: 0 });
          item.count++;
          item.totalMs += duration;
          item.maxMs = Math.max(item.maxMs, duration);
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch {}
    let expected = performance.now() + 1000;
    setInterval(() => {
      const now = performance.now();
      const drift = Math.max(0, now - expected);
      expected = now + 1000;
      if (document.hidden || drift < 250) return;
      state.stalls.count++;
      state.stalls.totalMs += drift;
      state.stalls.maxMs = Math.max(state.stalls.maxMs, drift);
    }, 1000);
    const route = () => location.pathname
      .replace(/\\b[BCDEFGHJKMNPQRTUWXYZ][A-Z0-9]{8,}\\b/g, ':id')
      .slice(0, 160);
    const navigation = (kind) => cap(state.navigations, { kind, atMs: Math.round(performance.now()), route: route() }, 80);
    addEventListener('popstate', () => navigation('popstate'));
    addEventListener('hashchange', () => navigation('hashchange'));
    addEventListener('click', (event) => {
      if (event.target && event.target.closest && event.target.closest('a,[role="link"],[data-qa-channel-sidebar-channel-type]')) {
        navigation('click');
      }
    }, true);
    state.markAction = (name, phase, durationMs) => {
      cap(state.actions, {
        name: String(name || 'action').replace(/[^a-z0-9:_-]/gi, '').slice(0, 48),
        phase: phase === 'start' ? 'start' : 'end',
        atMs: Math.round(performance.now()),
        durationMs: Number.isFinite(durationMs) ? Math.round(durationMs * 100) / 100 : undefined,
      }, 120);
    };
    state.snapshot = () => ({
      version: state.version,
      uptimeMs: Math.round(performance.now()),
      hidden: document.hidden,
      route: route(),
      longTasks: {
        count: state.longTasks.count,
        totalMs: Math.round(state.longTasks.totalMs),
        maxMs: Math.round(state.longTasks.maxMs),
      },
      events: {
        count: state.events.count,
        totalMs: Math.round(state.events.totalMs),
        maxMs: Math.round(state.events.maxMs),
        byType: Object.fromEntries(Object.entries(state.events.byType).map(([name, item]) => [name, {
          count: item.count,
          totalMs: Math.round(item.totalMs),
          maxMs: Math.round(item.maxMs),
        }])),
      },
      stalls: {
        count: state.stalls.count,
        totalMs: Math.round(state.stalls.totalMs),
        maxMs: Math.round(state.stalls.maxMs),
      },
      navigations: state.navigations.slice(),
      actions: state.actions.slice(),
      dom: window.__slickDOM && window.__slickDOM.snapshot ? window.__slickDOM.snapshot() : null,
    });
    window.__slickPerf = state;
  })()`;
}

function slackVersion() {
  if (process.platform === 'darwin') {
    try {
      return execFileSync(
        '/usr/bin/plutil',
        [
          '-extract',
          'CFBundleShortVersionString',
          'raw',
          '-o',
          '-',
          path.resolve(process.resourcesPath, '..', 'Info.plist'),
        ],
        { encoding: 'utf8' },
      ).trim();
    } catch {}
  }
  for (const file of [
    path.resolve(process.resourcesPath, '..', 'version'),
    path.join(process.resourcesPath, '.slack-version'),
  ]) {
    try {
      return fs.readFileSync(file, 'utf8').trim().slice(0, 40);
    } catch {}
  }
  return '';
}

function systemInfo(app) {
  return {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    cpus: os.cpus().length,
    memoryMb: Math.round(os.totalmem() / 1024 / 1024),
    slickVersion: app.getVersion?.() || '',
    slackVersion: slackVersion(),
    electronVersion: process.versions.electron || '',
    chromeVersion: process.versions.chrome || '',
    nodeVersion: process.versions.node || '',
    commandLineSwitches: process.argv
      .filter((arg) => arg.startsWith('--'))
      .map((arg) => arg.split('=')[0])
      .toSorted(),
    switchAblation: {
      disabled: String(process.env.SLICK_DISABLE_SWITCHES || '')
        .split(',')
        .filter(Boolean),
      gpuDisabled: process.env.SLICK_DISABLE_GPU === '1',
    },
  };
}

function create({ app, electron, settingsDir, enabledPlugins, activeTheme }) {
  const sessionsFile = path.join(settingsDir, 'performance-sessions.json');
  const previous = readJson(sessionsFile, []);
  const session = {
    schemaVersion: SCHEMA_VERSION,
    id: `${Date.now()}-${process.pid}`,
    startedAt: new Date().toISOString(),
    endedAt: null,
    system: systemInfo(app),
    enabledPlugins: [...enabledPlugins],
    theme: activeTheme || '',
    boot: null,
    events: [],
    samples: [],
    renderer: [],
    network: { total: 0, failed: 0, blocked: 0, byType: {} },
  };
  let sessions = Array.isArray(previous) ? previous.slice(-(MAX_SESSIONS - 1)) : [];
  let sampleTimer;
  let writeTimer;
  let getWindows = () => [];
  let writing = false;
  let finished = false;

  function record(type, detail = {}) {
    boundedPush(
      session.events,
      { atMs: Math.round(performance.now()), type: String(type).slice(0, 64), detail: sanitize(detail) },
      MAX_EVENTS,
    );
  }

  function setBoot(boot) {
    session.boot = sanitize(boot);
  }

  async function rendererSnapshots() {
    const snapshots = [];
    for (const win of getWindows()) {
      const wc = win && win.webContents;
      if (!wc || wc.isDestroyed()) continue;
      try {
        const snapshot = await wc.mainFrame.executeJavaScript(
          'window.__slickPerf && window.__slickPerf.snapshot ? window.__slickPerf.snapshot() : null',
          true,
        );
        if (snapshot) snapshots.push({ windowId: wc.id, ...sanitize(snapshot) });
      } catch {}
    }
    return snapshots;
  }

  async function sample() {
    let metrics = [];
    try {
      metrics = app.getAppMetrics();
    } catch {}
    const processes = metrics.map((metric) => ({
      type: metric.type,
      cpuPercent: finite(metric.cpu?.percentCPUUsage),
      idleWakeups: finite(metric.cpu?.idleWakeupsPerSecond),
      workingSetKb: finite(metric.memory?.workingSetSize),
      privateKb: finite(metric.memory?.privateBytes),
    }));
    const renderer = await rendererSnapshots();
    boundedPush(
      session.samples,
      {
        atMs: Math.round(performance.now()),
        processes,
        renderer: renderer.map((item) => ({
          windowId: item.windowId,
          hidden: item.hidden,
          longTasks: item.longTasks,
          events: item.events,
          stalls: item.stalls,
          dom: item.dom,
        })),
      },
      MAX_SAMPLES,
    );
    session.renderer = renderer;
    persist();
  }

  function payload() {
    return [...sessions, sanitize(session)].slice(-MAX_SESSIONS);
  }

  function persist() {
    if (writing) return;
    writing = true;
    try {
      fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(sessionsFile, JSON.stringify(payload(), null, 2) + '\n');
    } catch (error) {
      console.error('[slick-diagnostics] persist failed:', error.message);
    } finally {
      writing = false;
    }
  }

  async function gpuInfo() {
    let featureStatus = {};
    let basic = {};
    try {
      featureStatus = app.getGPUFeatureStatus();
    } catch {}
    try {
      basic = await app.getGPUInfo('basic');
    } catch {}
    return sanitize({
      featureStatus,
      gpuDeviceCount: Array.isArray(basic.gpuDevice) ? basic.gpuDevice.length : 0,
      auxAttributes: basic.auxAttributes,
    });
  }

  async function buildBundle() {
    await sample();
    return sanitize({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      privacy:
        'Local export. URLs, Slack identifiers, tokens, messages, custom CSS, filenames, and setting values are excluded.',
      gpu: await gpuInfo(),
      sessions: payload(),
    });
  }

  async function exportBundle() {
    const result = await electron.dialog.showSaveDialog({
      title: 'Export Slick performance diagnostics',
      defaultPath: `slick-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return '';
    const bundle = await buildBundle();
    fs.writeFileSync(result.filePath, JSON.stringify(bundle, null, 2) + '\n', { mode: 0o600 });
    console.log(`[slick-diagnostics] exported ${result.filePath}`);
    return result.filePath;
  }

  function start(windowProvider) {
    getWindows = windowProvider;
    sampleTimer = setInterval(() => sample().catch(() => {}), SAMPLE_MS);
    writeTimer = setInterval(persist, WRITE_MS);
    sampleTimer.unref?.();
    writeTimer.unref?.();
    setTimeout(() => sample().catch(() => {}), 3000).unref?.();
  }

  function finish(reason = 'quit') {
    if (finished) return;
    finished = true;
    clearInterval(sampleTimer);
    clearInterval(writeTimer);
    session.endedAt = new Date().toISOString();
    record('session-end', { reason });
    persist();
  }

  return {
    buildBundle,
    exportBundle,
    finish,
    record,
    network(type, result) {
      const name = String(type || 'unknown')
        .replace(/[^a-z0-9_-]/gi, '')
        .slice(0, 40);
      session.network.total++;
      session.network.byType[name] = (session.network.byType[name] || 0) + 1;
      if (result === 'blocked') session.network.blocked++;
      else if (result !== 'ok' && result !== 'net::ERR_ABORTED') session.network.failed++;
    },
    rendererProbeSource,
    setBoot,
    start,
    updateConfig(nextPlugins, nextTheme) {
      session.enabledPlugins = [...nextPlugins];
      session.theme = nextTheme || '';
    },
  };
}

module.exports = { SCHEMA_VERSION, create, redactString, rendererProbeSource, sanitize };
