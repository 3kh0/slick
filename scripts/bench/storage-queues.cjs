// Run with Bun: bun scripts/bench/storage-queues.cjs <baseline-ref>
// Opens a hidden Electron window with an isolated temporary profile. Requires
// a graphical environment (or Xvfb on Linux); never reads Slack/browser data.
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');
const electron = require('electron');
const root = path.resolve(__dirname, '../..');
const baseline = process.argv[2] || '8e1a66e';
const temp = mkdtempSync(path.join(os.tmpdir(), 'slick-storage-queues-bench-'));

async function runFixture(runIndex = 0) {
  const namespace = 'plugin:MessageLogger';
  const records = 512;
  const valueBytes = 64;
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('slick', 1);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore('blobs');
      request.result.createObjectStore('usage');
    });
    request.addEventListener('error', () => reject(request.error));
    request.addEventListener('success', () => {
      const db = request.result;
      const tx = db.transaction(['blobs', 'usage'], 'readwrite');
      for (let i = 0; i < records; i++)
        tx.objectStore('blobs').put('x'.repeat(valueBytes), [namespace, 'entry:' + String(i).padStart(4, '0')]);
      tx.objectStore('usage').put({ keys: records, bytes: records * valueBytes }, namespace);
      tx.addEventListener('complete', () => {
        db.close();
        resolve();
      });
      tx.addEventListener('error', () => reject(tx.error));
      tx.addEventListener('abort', () => reject(tx.error));
    });
  });
  // localStorage provides a real, independent browser store. Its async wrapper
  // models the StorageArea shape, not browser.storage.local IPC latency.
  const area = {
    get: async (keys) => Object.fromEntries([keys].flat().map((key) => [key, localStorage.getItem(key) ?? undefined])),
    set: async (values) => {
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    },
    remove: async (keys) => {
      for (const key of [keys].flat()) localStorage.removeItem(key);
    },
  };
  const stores = {};
  const rangeSignals = {};
  const rangeCalls = { baseline: 0, candidate: 0 };
  for (const [mode, api] of [
    ['baseline', BaselineStorage],
    ['candidate', CandidateStorage],
  ]) {
    const backend = NativeBlobs.indexedDbBackend();
    const range = backend.range;
    backend.range = (...args) => {
      rangeCalls[mode]++;
      rangeSignals[mode]?.();
      return range(...args);
    };
    stores[mode] = api.createStorage(area, backend);
    await stores[mode].dispatch({ method: 'blob.read', args: [namespace, 'entry:0000'] });
  }
  const samples = [];
  for (let repeat = 0; repeat < 6; repeat++) {
    for (const mode of repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      let began;
      const started = new Promise((resolve) => {
        began = resolve;
      });
      rangeSignals[mode] = began;
      rangeCalls[mode] = 0;
      const archiveStart = performance.now();
      const archive = stores[mode].dispatch({ method: 'blob.readAll', args: [namespace, '', ''] });
      await started;
      rangeSignals[mode] = undefined;
      const settingsStart = performance.now();
      const settings = await stores[mode].dispatch({ method: 'readSettings', args: [] });
      const settingsMs = performance.now() - settingsStart;
      const data = await archive;
      const archiveMs = performance.now() - archiveStart;
      if (!settings.ok || typeof settings.value !== 'string') throw Error('Settings result changed');
      if (
        !data.ok ||
        Object.keys(data.value).length !== records ||
        Object.values(data.value).some((value) => value.length !== valueBytes)
      )
        throw Error('Archive result changed');
      samples.push({ mode, repeat, settingsMs, archiveMs, rangeCalls: rangeCalls[mode] });
    }
  }
  const migrationSamples = [];
  for (const mode of runIndex % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
    const api = mode === 'baseline' ? BaselineStorage : CandidateStorage;
    const backend = NativeBlobs.indexedDbBackend();
    await backend.clear(namespace);
    const legacyKey = 'slick:firefox:blobs:' + namespace;
    const legacy = Object.fromEntries(
      Array.from({ length: records }, (_, i) => ['legacy:' + String(i).padStart(4, '0'), 'y'.repeat(128)]),
    );
    const legacyData = new Map([[legacyKey, legacy]]);
    const legacyArea = {
      get: async (keys) => structuredClone(Object.fromEntries([keys].flat().map((key) => [key, legacyData.get(key)]))),
      remove: async (keys) => {
        for (const key of [keys].flat()) legacyData.delete(key);
      },
      set: async (values) => {
        for (const [key, value] of Object.entries(values)) legacyData.set(key, value);
      },
    };
    let signal;
    const started = new Promise((resolve) => {
      signal = resolve;
    });
    let getCalls = 0;
    let putCalls = 0;
    const get = backend.get;
    const put = backend.put;
    backend.get = (...args) => {
      getCalls++;
      signal();
      return get(...args);
    };
    backend.put = (...args) => {
      putCalls++;
      return put(...args);
    };
    const store = api.createStorage(legacyArea, backend);
    const migrationStart = performance.now();
    const migration = store.dispatch({ method: 'blob.read', args: [namespace, 'legacy:0000'] });
    await started;
    const settingsStart = performance.now();
    const settings = await store.dispatch({ method: 'readSettings', args: [] });
    const settingsMs = performance.now() - settingsStart;
    const read = await migration;
    const migrationMs = performance.now() - migrationStart;
    if (!settings.ok || typeof settings.value !== 'string' || !read.ok || read.value !== legacy['legacy:0000'])
      throw Error('Migration response changed');
    const migrated = await backend.range(namespace, '', false, records + 1);
    if (
      migrated.length !== records ||
      migrated.some(([key, value]) => legacy[key] !== value) ||
      legacyData.has(legacyKey)
    )
      throw Error('Migration persistence changed');
    migrationSamples.push({ mode, records, settingsMs, migrationMs, getCalls, putCalls });
  }
  return {
    records,
    valueBytes,
    samples,
    migrationSamples,
    validation: {
      settingsUnchanged: true,
      archiveValuesUnchanged: true,
      migrationValuesPreserved: true,
      legacyRemovedAfterMigration: true,
    },
  };
}

const worker = `
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.setPath('userData', path.join(__dirname, 'profile-' + process.argv[2]));
app.setPath('crashDumps', path.join(__dirname, 'crashes-' + process.argv[2]));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await window.loadFile(path.join(__dirname, 'fixture.html'));
  const result = await window.webContents.executeJavaScript('runFixture(' + Number(process.argv[2]) + ')');
  console.log(JSON.stringify({ engine: { electron: process.versions.electron, chrome: process.versions.chrome }, ...result }));
  window.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
`;

async function main() {
  const old = spawnSync('git', ['show', baseline + ':src/extension/storage.ts'], { cwd: root, encoding: 'utf8' });
  if (old.status !== 0) throw Error(old.stderr || 'Baseline unavailable');
  for (const [name, contents, globalName] of [
    ['baseline', old.stdout, 'BaselineStorage'],
    ['candidate', readFileSync(path.join(root, 'src/extension/storage.ts'), 'utf8'), 'CandidateStorage'],
    ['native', readFileSync(path.join(root, 'src/extension/blobs.ts'), 'utf8'), 'NativeBlobs'],
  ]) {
    const result = await build({
      stdin: { contents, loader: 'ts', resolveDir: path.join(root, 'src/extension') },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName,
      write: false,
    });
    writeFileSync(path.join(temp, name + '.js'), result.outputFiles[0].contents);
  }
  writeFileSync(path.join(temp, 'renderer.js'), 'globalThis.runFixture = ' + runFixture.toString());
  writeFileSync(path.join(temp, 'worker.cjs'), worker);
  writeFileSync(
    path.join(temp, 'fixture.html'),
    '<!doctype html><script src="baseline.js"></script><script src="candidate.js"></script><script src="native.js"></script><script src="renderer.js"></script>',
  );
  const results = [];
  for (let run = 0; run < 3; run++) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(electron, [path.join(temp, 'worker.cjs'), String(run)], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (child.status !== 0) throw Error(child.stderr || child.error || 'IndexedDB fixture failed');
    results.push({ run, ...JSON.parse(child.stdout) });
  }
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(
    ['baseline', 'candidate'].map((mode) => {
      const samples = results.flatMap((result) => result.samples).filter((sample) => sample.mode === mode);
      return [
        mode,
        {
          medianSettingsMs: median(samples.map((sample) => sample.settingsMs)),
          medianArchiveMs: median(samples.map((sample) => sample.archiveMs)),
          rangeCallsPerArchive: samples[0].rangeCalls,
        },
      ];
    }),
  );
  const migrationSummary = Object.fromEntries(
    ['baseline', 'candidate'].map((mode) => {
      const samples = results.flatMap((result) => result.migrationSamples).filter((sample) => sample.mode === mode);
      return [
        mode,
        {
          medianSettingsMs: median(samples.map((sample) => sample.settingsMs)),
          medianMigrationMs: median(samples.map((sample) => sample.migrationMs)),
          records: samples[0].records,
          getCalls: samples[0].getCalls,
          putCalls: samples[0].putCalls,
        },
      ];
    }),
  );
  console.log(
    JSON.stringify(
      {
        scope:
          'Settings-read latency while an actual Chromium IndexedDB archive page is loading; separate localStorage-backed settings fixture, not browser.storage.local IPC.',
        baseline,
        freshProfiles: 3,
        samplesPerArmPerProfile: 6,
        summary,
        migrationSummary,
        results,
      },
      null,
      2,
    ),
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => rmSync(temp, { recursive: true, force: true }));
