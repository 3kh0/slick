// bun scripts/bench/message-logger.cjs [baseline-ref]
// Exact plugin sources in three isolated Electron/V8 Node processes. No GUI,
// Slack profile, auth, disk archive or real message content is used.
const check = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');
const electron = require('electron');
const root = path.resolve(__dirname, '../..');
const baselineRef = process.argv[2] || '8e1a66e';
const sourcePath = 'src/plugins/MessageLogger/index.ts';
const temp = mkdtempSync(path.join(tmpdir(), 'slick-message-logger-bench-'));

function runFixture() {
  const assert = require('node:assert/strict');
  globalThis.React = { createContext: () => ({}) };
  const classes = { baseline: require('./baseline.cjs').default, candidate: require('./candidate.cjs').default };
  function populated(Plugin, legacyCount = 0) {
    const plugin = new Plugin({}, { retentionDays: 0 });
    const put = (key, entry) => (plugin.setEntry ? plugin.setEntry(key, entry) : plugin.entries.set(key, entry));
    for (let i = 0; i < 1000; i++) put(`C${i % 4}:${i}`, { channel: `C${i % 4}`, ts: String(i), at: 1 });
    for (let i = 0; i < legacyCount; i++) put(`archived-${i}`, { channel: 'C0', ts: `legacy-${i}`, at: 1 });
    return plugin;
  }
  const visits = [];
  for (const legacyCount of [0, 20])
    for (const [mode, Plugin] of Object.entries(classes)) {
      const plugin = populated(Plugin, legacyCount);
      let examined = 0;
      for (const map of [plugin.entries, plugin.legacyEntries].filter(Boolean)) {
        const values = map.values.bind(map);
        map.values = function* () {
          for (const entry of values()) {
            examined++;
            yield entry;
          }
        };
      }
      for (let i = 0; i < 200; i++) assert.equal(plugin.entryFor({ channel: 'C0', ts: `missing-${i}` }), undefined);
      visits.push({ mode, legacyCount, lookups: 200, examined, auxiliaryEntries: plugin.legacyEntries?.size ?? 0 });
    }
  // Compare actual returned entries for known, absent, and context-free cases.
  const pair = Object.values(classes).map((Plugin) => populated(Plugin, 20));
  for (const args of [
    [{ channel: 'C0', ts: '0' }],
    [{ channel: 'C1', ts: '0' }],
    [{ ts: '0' }],
    [{ ts: 'missing' }],
    [{ channel: 'C0', ts: 'legacy-1' }],
    [{ channel: 'C1', ts: 'legacy-1' }],
    [{ ts: 'legacy-1' }, 'C0'],
    [{ ts: 'legacy-1' }],
  ])
    assert.deepEqual(pair[0].entryFor(...args), pair[1].entryFor(...args));
  const plugins = Object.fromEntries(Object.entries(classes).map(([mode, Plugin]) => [mode, populated(Plugin)]));
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    channel: `C${i % 4}`,
    ts: i % 10 ? `missing-${i}` : String(i),
  }));
  function work(plugin, rounds) {
    let hits = 0;
    for (let round = 0; round < rounds; round++) for (const row of rows) if (plugin.entryFor(row)) hits++;
    return hits;
  }
  for (const plugin of Object.values(plugins)) assert.equal(work(plugin, 3), 300);
  const samples = [];
  for (let repeat = 0; repeat < 6; repeat++)
    for (const mode of repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const start = performance.now();
      const hits = work(plugins[mode], 20);
      const elapsedMs = performance.now() - start;
      assert.equal(hits, 2000);
      samples.push({ mode, repeat, elapsedMs, lookups: 20000, hits });
    }
  console.log(JSON.stringify({ engine: process.versions, visits, samples }));
}

async function main() {
  const baseline = execFileSync('git', ['show', `${baselineRef}:${sourcePath}`], { cwd: root, encoding: 'utf8' });
  const candidate = readFileSync(path.join(root, sourcePath), 'utf8');
  for (const [mode, contents] of [
    ['baseline', baseline],
    ['candidate', candidate],
  ]) {
    const result = await build({
      stdin: { contents, resolveDir: path.dirname(path.join(root, sourcePath)), loader: 'ts' },
      tsconfig: path.join(root, 'tsconfig.json'),
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
    });
    writeFileSync(path.join(temp, `${mode}.cjs`), result.outputFiles[0].contents);
  }
  writeFileSync(path.join(temp, 'worker.cjs'), `(${runFixture.toString()})()`);
  const runs = [];
  for (let run = 0; run < 3; run++) {
    const output = execFileSync(electron, [path.join(temp, 'worker.cjs')], {
      cwd: root,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      timeout: 60000,
    });
    runs.push({ run, ...JSON.parse(output) });
  }
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(
    ['baseline', 'candidate'].map((mode) => [
      mode,
      {
        medianMs: median(
          runs
            .flatMap((run) => run.samples)
            .filter((sample) => sample.mode === mode)
            .map((sample) => sample.elapsedMs),
        ),
      },
    ]),
  );
  for (const run of runs) {
    check.equal(run.visits.find((item) => item.mode === 'baseline' && item.legacyCount === 0).examined, 200000);
    check.equal(run.visits.find((item) => item.mode === 'candidate' && item.legacyCount === 0).examined, 0);
    check.equal(run.visits.find((item) => item.mode === 'candidate' && item.legacyCount === 20).examined, 4000);
  }
  console.log(
    JSON.stringify(
      {
        baselineRef,
        summary,
        runs,
        scope:
          'Optional MessageLogger row lookups only: 1000 canonical archived records, 90% misses, 20,000 lookups/sample. Source-level synthetic workload, not whole-app navigation.',
        compatibility:
          'Timestamp-only and noncanonical archive fallback checked; canonical records add no auxiliary entries. Legacy-only worst-case scans remain linear.',
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
