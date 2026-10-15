// Run with Bun: bun scripts/bench/blob-keys.cjs <baseline-ref>
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
const temp = mkdtempSync(path.join(os.tmpdir(), 'slick-blob-keys-bench-'));

async function runFixture() {
  const namespace = 'plugin:MessageLogger';
  const records = 1024;
  const valueBytes = 16384;
  const expected = Array.from({ length: records }, (_, index) => 'entry:' + String(index).padStart(4, '0'));
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('slick', 1);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore('blobs');
      request.result.createObjectStore('usage');
    });
    request.addEventListener('error', () => reject(request.error));
    request.addEventListener('success', () => {
      const db = request.result;
      const transaction = db.transaction(['blobs', 'usage'], 'readwrite');
      const store = transaction.objectStore('blobs');
      for (let index = 0; index < records; index++) {
        const prefix = index + ':';
        store.put(prefix + 'x'.repeat(valueBytes - prefix.length), [namespace, expected[index]]);
      }
      store.put('unrelated namespace', ['plugin:LastSeen', 'other']);
      transaction.objectStore('usage').put({ keys: records, bytes: records * valueBytes }, namespace);
      transaction.addEventListener('complete', () => {
        db.close();
        resolve();
      });
      transaction.addEventListener('error', () => reject(transaction.error));
      transaction.addEventListener('abort', () => reject(transaction.error));
    });
  });
  const storage = { get: async () => ({}), remove: async () => {}, set: async () => {} };
  const baseBackend = BaselineBlobs.indexedDbBackend();
  const nextBackend = CandidateBlobs.indexedDbBackend();
  const execute = {
    baseline: BaselineBlobs.createBlobs(storage, baseBackend),
    candidate: CandidateBlobs.createBlobs(storage, nextBackend),
  };
  async function list(mode) {
    const keys = [];
    let cursor = '';
    for (;;) {
      const page = await execute[mode]({ method: 'blob.list', args: [namespace, cursor] });
      keys.push(...page);
      if (page.length < 512) return keys;
      cursor = page.at(-1);
    }
  }
  function equal(actual, wanted) {
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw Error('Listing behavior changed');
  }
  // Warm database connections, complete migration checks, and verify pagination.
  equal(await list('baseline'), expected);
  equal(await list('candidate'), expected);
  equal(await nextBackend.keys(namespace, expected[11], false, 7), expected.slice(11, 18));
  equal(await nextBackend.keys(namespace, expected[11], true, 7), expected.slice(12, 19));
  equal(await nextBackend.keys('plugin:LastSeen', '', false, 512), ['other']);
  equal(await nextBackend.keys('plugin:HumanCount', '', false, 512), []);
  if ((await nextBackend.get(namespace, expected[0])).length !== valueBytes) throw Error('Value read changed');

  const methods = ['getAll', 'getAllKeys'];
  const calls = { getAll: 0, getAllKeys: 0 };
  for (const method of methods) {
    const original = IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method] = function (...args) {
      calls[method]++;
      return original.apply(this, args);
    };
  }
  const samples = [];
  for (let repeat = 0; repeat < 6; repeat++) {
    for (const mode of repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      calls.getAll = calls.getAllKeys = 0;
      const start = performance.now();
      const keys = await list(mode);
      const elapsedMs = performance.now() - start;
      equal(keys, expected);
      samples.push({ mode, repeat, elapsedMs, requests: { ...calls } });
    }
  }
  return {
    records,
    valueBytes,
    namespaceValueBytes: records * valueBytes,
    samples,
    validation: {
      orderedPagination: true,
      inclusiveExclusiveCursors: true,
      namespaceIsolation: true,
      valueReadsUnchanged: true,
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
  const result = await window.webContents.executeJavaScript('runFixture()');
  console.log(JSON.stringify({ engine: { electron: process.versions.electron, chrome: process.versions.chrome }, ...result }));
  window.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
`;

async function main() {
  const old = spawnSync('git', ['show', baseline + ':src/extension/blobs.ts'], { cwd: root, encoding: 'utf8' });
  if (old.status !== 0) throw Error(old.stderr || 'Baseline unavailable');
  for (const [name, contents, globalName] of [
    ['baseline', old.stdout, 'BaselineBlobs'],
    ['candidate', readFileSync(path.join(root, 'src/extension/blobs.ts'), 'utf8'), 'CandidateBlobs'],
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
    '<!doctype html><script src="baseline.js"></script><script src="candidate.js"></script><script src="renderer.js"></script>',
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
        { medianMs: median(samples.map((sample) => sample.elapsedMs)), requestsPerFullListing: samples[0].requests },
      ];
    }),
  );
  console.log(
    JSON.stringify(
      {
        scope:
          'Actual Chromium IndexedDB with synthetic archive values; full namespace listing only, not Slack navigation.',
        baseline,
        freshProfiles: 3,
        samplesPerArmPerProfile: 6,
        summary,
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
