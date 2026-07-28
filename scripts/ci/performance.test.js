'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { analyze } = require('../perf/analyze');
const { configureVariant, removeCaches } = require('../perf/benchmark');
const { collectTree, createSampler, parsePosixCpuSeconds, parseWindowsLine } = require('../perf/sampler');
const { redactString, rendererProbeSource, sanitize } = require('../byoe/diagnostics');
const settings = require('../byoe/settings-ui');
const { buildCatalog, hydrateCatalog, loadPlugins } = require('../byoe/plugins');
const { createWatcher } = require('../byoe/watch');

const ROOT = path.resolve(__dirname, '..', '..');
const PLUGINS_DIR = path.join(ROOT, 'plugins');
const THEMES_DIR = path.join(ROOT, 'themes');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quietly = (fn) => {
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
};

test('diagnostic exports remove identifiers, secrets, and content fields', () => {
  const input = {
    url: 'https://app.slack.com/client/T1234567890/C1234567890?token=xoxb-secret-value',
    message: 'private message',
    customCss: 'body { display: none }',
    domContentLoadedMs: 123,
    nested: { userId: 'U1234567890', safe: true },
  };
  const output = sanitize(input);
  assert.equal(output.message, undefined);
  assert.equal(output.customCss, undefined);
  assert.equal(output.nested.safe, true);
  assert.equal(output.domContentLoadedMs, 123);
  assert.match(output.url, /^https:\/\/app\.slack\.com\/\[redacted\]$/);
  assert.doesNotMatch(JSON.stringify(output), /T123|C123|U123|xoxb|private message/);
  assert.equal(redactString('Bearer secret'), '[redacted-token]');
});

test('sanitize keeps the fields a slowness report is opened for', () => {
  const session = {
    samples: [
      {
        atMs: 1,
        processes: [{ type: 'GPU', cpuPercent: 42.5, workingSetKb: 100 }],
        renderer: [{ windowId: 1, hidden: false, dom: { plugins: { MessageLogger: { calls: 7, ms: 12.5 } } } }],
      },
    ],
  };
  const output = sanitize(session);
  const sample = output.samples[0];
  assert.equal(sample.processes[0].cpuPercent, 42.5, 'per-process CPU must survive the depth budget');
  assert.equal(sample.renderer[0].dom.plugins.MessageLogger.calls, 7, 'per-plugin DOM attribution must survive');
  assert.doesNotMatch(JSON.stringify(output), /truncated/);
});

test('sanitize keeps the newest entries of an over-long rolling array', () => {
  const output = sanitize({ samples: Array.from({ length: 900 }, (_unused, index) => ({ atMs: index })) });
  assert.equal(output.samples.length, 800);
  assert.equal(output.samples.at(-1).atMs, 899, 'the recent end of a rolling log is the useful end');
});

test('renderer performance probe is valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(rendererProbeSource(true)));
});

test('diagnostic control invokes the local export callback', async () => {
  let exports = 0;
  const handled = settings.handleControl('https://slick.control/?op=diagnostics', {
    catalog: { plugins: [], themes: [] },
    onDiagnostics: async () => exports++,
  });
  assert.equal(handled, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exports, 1);
});

test('plugin renderer sources retain their plugin attribution', () => {
  const result = loadPlugins({
    catalog: {
      plugins: [
        {
          dir: 'Example',
          mod: { meta: { name: 'Example' }, renderer: 'window.example = true' },
          schema: [],
        },
      ],
    },
    enabled: ['Example'],
    electron: { app: {} },
    settings: {},
  });
  assert.equal(result.js.at(-1).name, 'Example');
  assert.match(result.js.at(-1).source, /window\.example/);
});

test('advisory analysis requires relative and absolute startup regressions', () => {
  const runs = [
    { variant: 'stock', cold: false, startupMs: 1000, interactions: [], processSamples: [] },
    { variant: 'stock', cold: false, startupMs: 1100, interactions: [], processSamples: [] },
    { variant: 'core', cold: false, startupMs: 1400, interactions: [], processSamples: [] },
    { variant: 'core', cold: false, startupMs: 1500, interactions: [], processSamples: [] },
  ];
  const report = analyze({ runs });
  assert.equal(report.advisory, true);
  assert.equal(report.comparisons['core:warm'].pass, false);
  assert.match(report.comparisons['core:warm'].failures.join(' '), /startup p50/);
});

test('analysis preserves plugin variants containing colons', () => {
  const report = analyze({
    runs: [
      { variant: 'stock', cold: false, startupMs: 1000, interactions: [], processSamples: [] },
      { variant: 'plugin:MessageLogger', cold: false, startupMs: 1100, interactions: [], processSamples: [] },
    ],
  });
  assert.ok(report.comparisons['plugin:MessageLogger:warm']);
});

test('release qualification compares platforms independently and requires all three', () => {
  const report = analyze(
    {
      runs: [
        {
          platform: 'darwin',
          arch: 'arm64',
          variant: 'stock',
          cold: false,
          startupMs: 1000,
          interactions: [],
          processSamples: [],
        },
        {
          platform: 'darwin',
          arch: 'arm64',
          variant: 'core',
          cold: false,
          startupMs: 1100,
          interactions: [],
          processSamples: [],
        },
      ],
    },
    { enforce: true },
  );
  assert.ok(report.comparisons['darwin/arm64|core:warm']);
  assert.equal(report.advisory, false);
  assert.equal(report.qualification.releaseReady, false);
  assert.deepEqual(report.qualification.missingPlatforms, ['linux/x64', 'win32/x64']);
});

test('a lazily built catalog hydrates into exactly the eager one', () => {
  const dirs = { pluginsDir: PLUGINS_DIR, themesDir: THEMES_DIR };
  const eager = buildCatalog(dirs);
  const lazy = buildCatalog({ ...dirs, only: ['NoTrack', 'Snappy'] });

  assert.ok(
    lazy.plugins.filter((plugin) => plugin.lazy).length > 0,
    'expected some plugins to be deferred by the `only` option',
  );
  assert.deepEqual(lazy.themes, [], 'theme metadata is a settings-UI concern, not a boot concern');
  assert.deepEqual(
    lazy.plugins.map((plugin) => plugin.dir),
    eager.plugins.map((plugin) => plugin.dir),
    'deferred entries must still expose their directory name',
  );

  hydrateCatalog(lazy);
  const shape = (catalog) => catalog.plugins.map(({ dir, meta, schema }) => ({ dir, meta, schema }));
  assert.deepEqual(shape(lazy), shape(eager));
  assert.deepEqual(lazy.themes, eager.themes);
  assert.ok(
    lazy.plugins.every((plugin) => !plugin.lazy),
    'hydration must clear every deferred marker',
  );
});

test('loadPlugins loads plugins the catalog deferred', () => {
  const dirs = { pluginsDir: PLUGINS_DIR, themesDir: THEMES_DIR };
  const electron = { app: { getPath: () => os.tmpdir(), on() {} }, session: {}, ipcMain: { on() {}, handle() {} } };

  // enabled: null means "load everything", which is more than the catalog holds.
  const fallback = quietly(() =>
    loadPlugins({
      catalog: buildCatalog({ ...dirs, only: ['NoTrack'] }),
      enabled: null,
      electron,
      settings: {},
    }),
  );
  assert.equal(fallback.loaded.length, buildCatalog(dirs).plugins.length);

  // An explicitly enabled plugin outside `only` must behave as if it were eager.
  const deferred = quietly(() =>
    loadPlugins({
      catalog: buildCatalog({ ...dirs, only: ['NoTrack'] }),
      enabled: ['MessageLogger', 'LastSeen'],
      electron,
      settings: {},
    }),
  );
  const eager = quietly(() =>
    loadPlugins({ catalog: buildCatalog(dirs), enabled: ['MessageLogger', 'LastSeen'], electron, settings: {} }),
  );
  assert.deepEqual(deferred.loaded, eager.loaded);
  assert.deepEqual(
    deferred.js.map((item) => item.name),
    eager.js.map((item) => item.name),
  );
});

test('the process sampler derives CPU from deltas and walks the whole tree', () => {
  assert.equal(parsePosixCpuSeconds('0:30.00'), 30);
  assert.equal(parsePosixCpuSeconds('2:01:30'), 7290);
  assert.equal(parsePosixCpuSeconds('1-00:00:01'), 86401);

  assert.deepEqual(parseWindowsLine('#100,4,20000000,1048576'), [
    { pid: 100, ppid: 4, cpuSeconds: 2, privateKb: 1024 },
  ]);
  assert.deepEqual(parseWindowsLine('#'), []);

  // Grandchildren count; unrelated processes do not.
  const rows = [
    { pid: 1, ppid: 0, cpuSeconds: 1, privateKb: 10 },
    { pid: 2, ppid: 1, cpuSeconds: 1, privateKb: 10 },
    { pid: 3, ppid: 2, cpuSeconds: 1, privateKb: 10 },
    { pid: 9, ppid: 8, cpuSeconds: 1, privateKb: 10 },
  ];
  assert.deepEqual(
    collectTree(rows, 1).map((row) => row.pid),
    [1, 2, 3],
  );

  // The first reading only establishes a baseline, so it yields nothing.
  const sampler = createSampler(process.pid);
  try {
    assert.equal(sampler.sample(), null);
  } finally {
    sampler.stop();
  }
});

test('file watching coalesces bursts and survives an atomic replace', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-watch-test-'));
  const target = path.join(dir, 'active-theme');
  fs.writeFileSync(target, 'first');
  const watcher = createWatcher({ debounceMs: 40 });
  let fired = 0;
  const dispose = watcher.watch(target, () => fired++);
  try {
    // Windows emits several events per logical change; callers get one.
    for (let index = 0; index < 6; index++) fs.writeFileSync(target, `burst-${index}`);
    await wait(300);
    assert.equal(fired, 1, 'a burst of writes must collapse to a single callback');

    // Write-temp-then-rename detaches a file-level watch but not a directory one.
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, 'replaced');
    fs.renameSync(temporary, target);
    await wait(300);
    assert.equal(fired, 2, 'an atomic replace must still be observed');

    dispose();
    fs.writeFileSync(target, 'after-dispose');
    await wait(300);
    assert.equal(fired, 2, 'the disposer must detach the listener');
  } finally {
    watcher.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('diagnostics persists compactly, keeps the session cap, and survives a sync finish', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-diag-test-'));
  const file = path.join(dir, 'performance-sessions.json');
  const previous = process.resourcesPath;
  if (!previous) process.resourcesPath = dir;
  try {
    const seeded = Array.from({ length: 12 }, (_unused, index) => ({ id: `old-${index}`, samples: [] }));
    fs.writeFileSync(file, JSON.stringify(seeded));

    const diagnostics = require('../byoe/diagnostics');
    const session = diagnostics.create({
      app: { getVersion: () => '1.0.0', getAppMetrics: () => [] },
      electron: {},
      settingsDir: dir,
      enabledPlugins: ['NoTrack'],
      activeTheme: 'amoled',
    });

    await session.persist();
    const written = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(written);
    assert.equal(parsed.length, 10, 'the rolling window keeps the newest ten sessions');
    assert.equal(parsed[0].id, 'old-3', 'the oldest sessions are dropped, not the newest');
    assert.equal(parsed.at(-1).theme, 'amoled');
    assert.doesNotMatch(written, /\n {2}/, 'the rolling file is compact; only exports are pretty-printed');

    session.finish('test');
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(after.length, 10);
    assert.ok(after.at(-1).endedAt, 'the sync write on quit must land');
    assert.ok(after.at(-1).events.some((event) => event.type === 'session-end'));
    assert.deepEqual(
      fs.readdirSync(dir).filter((name) => name.includes('.tmp')),
      [],
      'atomic writes must not leave temp files behind',
    );
  } finally {
    if (!previous) delete process.resourcesPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a diagnostic export carries the numbers, the applied switches, and complete GPU info', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-diag-export-'));
  const previous = process.resourcesPath;
  if (!previous) process.resourcesPath = dir;
  try {
    const diagnostics = require('../byoe/diagnostics');
    const requested = [];
    const session = diagnostics.create({
      app: {
        getVersion: () => '1.0.0',
        getAppMetrics: () => [{ type: 'GPU', cpu: { percentCPUUsage: 37.5 }, memory: { workingSetSize: 2048 } }],
        getGPUFeatureStatus: () => ({ gpu_compositing: 'enabled' }),
        getGPUInfo: (type) => {
          requested.push(type);
          return Promise.resolve({ gpuDevice: [{}], auxAttributes: { glImplementationParts: '(gl=egl,angle=d3d11)' } });
        },
      },
      electron: {},
      settingsDir: dir,
      enabledPlugins: ['Snappy'],
      activeTheme: '',
      slickSwitches: ['disable-features=CalculateNativeWinOcclusion', 'enable-zero-copy'],
    });

    const bundle = await session.buildBundle();
    assert.deepEqual(requested, ['complete'], "'basic' GPU info omits the backend fields the export exists to show");
    assert.equal(bundle.gpu.infoType, 'complete');
    assert.equal(bundle.gpu.auxAttributes.glImplementationParts, '(gl=egl,angle=d3d11)');
    const live = bundle.sessions.at(-1);
    assert.deepEqual(live.system.slickSwitches, ['disable-features=CalculateNativeWinOcclusion', 'enable-zero-copy']);
    assert.equal(live.samples.at(-1).processes[0].cpuPercent, 37.5);
    assert.doesNotMatch(JSON.stringify(bundle), /truncated/, 'the export is the artifact users send; it must be whole');
  } finally {
    if (!previous) delete process.resourcesPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applied switches are recorded for the export, including the settings-driven ones', () => {
  const { applySwitches, appliedSwitches } = require('../byoe/switches');
  const seen = [];
  const commandLine = {
    getSwitchValue: () => '',
    appendSwitch: (name, value) => seen.push(value ? `${name}=${value}` : name),
  };
  const before = appliedSwitches().length;
  applySwitches({
    app: { getPath: () => os.tmpdir(), disableHardwareAcceleration: () => {} },
    commandLine,
    crashReporter: {},
    pluginsDir: PLUGINS_DIR,
    snappySettings: { ignoreGpuBlocklist: true },
  });
  const recorded = appliedSwitches().slice(before);
  assert.deepEqual(recorded, seen, 'every switch handed to Chromium must show up in the export');
  assert.ok(recorded.includes('ignore-gpu-blocklist'));
  assert.ok(recorded.some((entry) => entry.startsWith('disable-features=')));
});

test('benchmark variants and cold-cache cleanup stay inside the disposable profile', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-perf-test-'));
  const profile = path.join(parent, 'profile');
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(path.join(profile, 'Default', 'Cache'), { recursive: true });
  fs.mkdirSync(path.join(outside, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'Default', 'Cache', 'inside'), 'inside');
  fs.writeFileSync(path.join(outside, 'Cache', 'outside'), 'outside');
  try {
    assert.deepEqual(configureVariant(profile, 'defaults'), ['NoTrack', 'Snappy']);
    removeCaches(profile);
    assert.equal(fs.existsSync(path.join(profile, 'Default', 'Cache')), false);
    assert.equal(fs.readFileSync(path.join(outside, 'Cache', 'outside'), 'utf8'), 'outside');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, 'slick', 'enabled-plugins.json'))), [
      'NoTrack',
      'Snappy',
    ]);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
