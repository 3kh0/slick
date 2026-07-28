'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCHEMA_VERSION = 1;
const MAX_SESSIONS = 10;
const MAX_EVENTS = 240;
const MAX_SAMPLES = 720;
// Deep enough for the deepest thing worth reading: session > samples[] > sample >
// renderer[] > snapshot > dom > plugins > <PluginName> > {calls,ms}. At the old
// budget of 6 the per-plugin DOM attribution and the per-process CPU numbers —
// the two fields a slowness report is opened for — arrived as "[truncated]".
const MAX_DEPTH = 12;
// Tail, not head: every capped array here (samples, events, navigations) is a
// rolling log, and a "it got slow after a while" report needs the recent end.
const MAX_ARRAY = 800;
const SAMPLE_MS = 15000;
const WRITE_MS = 60000;
const GPU_INFO_MS = 4000;
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
  if (depth > MAX_DEPTH || value == null) return value == null ? null : '[truncated]';
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number') return finite(value);
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(-MAX_ARRAY).map((item) => sanitize(item, depth + 1));
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

function systemInfo(app, slickSwitches) {
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
    slickSwitches: [...(slickSwitches || [])].toSorted(),
    switchAblation: {
      disabled: String(process.env.SLICK_DISABLE_SWITCHES || '')
        .split(',')
        .filter(Boolean),
      gpuDisabled: process.env.SLICK_DISABLE_GPU === '1',
    },
  };
}

function create({ app, electron, settingsDir, enabledPlugins, activeTheme, slickSwitches }) {
  const sessionsFile = path.join(settingsDir, 'performance-sessions.json');
  const session = {
    schemaVersion: SCHEMA_VERSION,
    id: `${Date.now()}-${process.pid}`,
    startedAt: new Date().toISOString(),
    endedAt: null,
    system: systemInfo(app, slickSwitches),
    enabledPlugins: [...enabledPlugins],
    theme: activeTheme || '',
    boot: null,
    events: [],
    samples: [],
    renderer: [],
    network: { total: 0, failed: 0, blocked: 0, byType: {} },
  };
  let sessions = [];
  let priorJson = null;
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
    // No write here — the WRITE_MS timer owns persistence. Sampling every 15s and
    // writing the whole rolling file each time was four writes per intended one.
    // Worst case an unclean exit loses the samples since the last write; finish()
    // covers every clean quit.
  }

  // The rolling file reaches several megabytes, and nothing needs the earlier
  // sessions until the first write 60s in — so this stays off the boot path.
  // Once loaded they are immutable, so serialize them once and splice the live
  // session on; re-stringifying them per write was the bulk of persist() cost.
  function loadPrior() {
    if (priorJson !== null) return priorJson;
    const previous = readJson(sessionsFile, []);
    sessions = Array.isArray(previous) ? previous.slice(-(MAX_SESSIONS - 1)) : [];
    priorJson = sessions.map((entry) => JSON.stringify(entry)).join(',');
    return priorJson;
  }

  function payload() {
    loadPrior();
    return [...sessions, sanitize(session)].slice(-MAX_SESSIONS);
  }

  // Compact, not pretty: this file is machine-read by the benchmark and by the
  // next launch. exportBundle() still pretty-prints, because that one is read by
  // people. Pretty-printing more than doubled the bytes and the stringify time.
  function serialize() {
    const prior = loadPrior();
    return `[${prior ? `${prior},` : ''}${JSON.stringify(sanitize(session))}]\n`;
  }

  // Distinct suffixes: finish() can fire while an async persist is still in
  // flight, and sharing one temp path would let the sync write land inside the
  // async one and get renamed into place half-formed.
  function writeAtomicSync(text) {
    const temporary = `${sessionsFile}.tmp-${process.pid}-s`;
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(temporary, text);
    fs.renameSync(temporary, sessionsFile);
  }

  async function persist() {
    if (writing) return;
    writing = true;
    const temporary = `${sessionsFile}.tmp-${process.pid}-a`;
    try {
      const text = serialize();
      await fsp.mkdir(settingsDir, { recursive: true });
      await fsp.writeFile(temporary, text);
      await fsp.rename(temporary, sessionsFile);
    } catch (error) {
      console.error('[slick-diagnostics] persist failed:', error.message);
      try {
        await fsp.rm(temporary, { force: true });
      } catch {}
    } finally {
      writing = false;
    }
  }

  // 'complete' is the only info type that fills in the fields a "the GPU is not
  // helping" theory needs — the GL/ANGLE backend, the Skia backend, and the
  // DirectComposition and overlay support flags. Under 'basic' those come back
  // as an unpopulated struct (gl=none, skiaBackendType None, every flag false),
  // which reads exactly like broken acceleration on a machine where it is fine.
  // It can take a moment or, if the GPU process is wedged, never settle — hence
  // the race, and hence keeping 'basic' as the fallback rather than nothing.
  async function gpuInfo() {
    let featureStatus = {};
    try {
      featureStatus = app.getGPUFeatureStatus();
    } catch {}
    let info = {};
    let infoType = 'complete';
    try {
      info = await Promise.race([
        app.getGPUInfo('complete'),
        new Promise((resolve) => setTimeout(() => resolve(null), GPU_INFO_MS).unref?.()),
      ]);
      if (!info) throw new Error('timed out');
    } catch {
      infoType = 'basic';
      info = {};
      try {
        info = await app.getGPUInfo('basic');
      } catch {}
    }
    return sanitize({
      featureStatus,
      infoType,
      gpuDeviceCount: Array.isArray(info.gpuDevice) ? info.gpuDevice.length : 0,
      auxAttributes: info.auxAttributes,
    });
  }

  // Everything here is sanitized already — the live session by payload(), the
  // prior sessions when they were written, the GPU block by gpuInfo(). Running
  // sanitize() over the assembled bundle spent two more depth levels on data
  // that had already paid for its own, which is what "[truncated]" in the
  // deepest fields of every export so far actually was.
  async function buildBundle() {
    await sample();
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      privacy:
        'Local export. URLs, Slack identifiers, tokens, messages, custom CSS, filenames, and setting values are excluded.',
      gpu: await gpuInfo(),
      sessions: payload(),
    };
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
    writeTimer = setInterval(() => persist().catch(() => {}), WRITE_MS);
    sampleTimer.unref?.();
    writeTimer.unref?.();
    setTimeout(() => sample().catch(() => {}), 3000).unref?.();
  }

  // Runs on before-quit, where an async write would not finish — stays sync.
  function finish(reason = 'quit') {
    if (finished) return;
    finished = true;
    clearInterval(sampleTimer);
    clearInterval(writeTimer);
    session.endedAt = new Date().toISOString();
    record('session-end', { reason });
    try {
      writeAtomicSync(serialize());
    } catch (error) {
      console.error('[slick-diagnostics] persist failed:', error.message);
    }
  }

  return {
    buildBundle,
    exportBundle,
    finish,
    record,
    persist,
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
