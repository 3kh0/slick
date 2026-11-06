// Run with Bun: bun scripts/bench/preload-sources.cjs <baseline-ref>
// Requires the repository's Electron dependency. Uses only generated preload
// text and temporary files; does not launch a window or read a Slack profile.
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');
const electron = require('electron');
const root = path.resolve(__dirname, '../..');
const baseline = process.argv[2] || '8e1a66e';
const temp = mkdtempSync(path.join(os.tmpdir(), 'slick-preload-bench-'));

const worker = `
const path = require('node:path');
const { createPreloadSources } = require('./' + process.argv[2] + '.cjs');
const count = Number(process.argv[3]);
const file = path.join(__dirname, 'fixture-preload.js');
const sourceBytes = require('node:fs').statSync(file).size;
async function collect() {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
  }
}
(async () => {
  const sources = createPreloadSources();
  await collect();
  const before = process.memoryUsage();
  const started = performance.now();
  const tokens = Array.from({ length: count }, () => sources.register(file));
  const createMs = performance.now() - started;
  for (const token of tokens) {
    if (sources.get(token)?.length !== sourceBytes) throw Error('Source changed');
  }
  await collect();
  const retained = process.memoryUsage();
  for (const token of tokens) sources.release(token);
  await collect();
  const released = process.memoryUsage();
  if (tokens.some(token => sources.get(token) !== null)) throw Error('Closed token survived');
  console.log(JSON.stringify({
    mode: process.argv[2], count, sourceBytes, createMs,
    engine: { electron: process.versions.electron, v8: process.versions.v8 },
    retainedHeapBytes: retained.heapUsed - before.heapUsed,
    releasedHeapBytes: released.heapUsed - before.heapUsed,
  }));
})().catch(error => { console.error(error); process.exitCode = 1; });
`;

async function main() {
  const old = spawnSync('git', ['show', baseline + ':src/desktop/patch.ts'], { cwd: root, encoding: 'utf8' });
  if (old.status !== 0) throw Error(old.stderr || 'Baseline unavailable');
  const start = old.stdout.indexOf('  function substitutePreload(');
  const end = old.stdout.indexOf('\n  const OrigBrowserWindow', start);
  if (start < 0 || end < 0 || !old.stdout.slice(start, end).includes('originalPreloads.set('))
    throw Error('Baseline does not contain the expected per-window source implementation');
  const baselineSource = `
    import crypto from 'node:crypto';
    import { readFileSync } from 'node:fs';
    export function createPreloadSources() {
      const originalPreloads = new Map<string, string>();
      const slickPreloadPath = 'slick-preload.js';
      ${old.stdout.slice(start, end)}
      return {
        register: (file: string) => substitutePreload({ preload: file }).preloadKey,
        get: (key: string) => originalPreloads.get(key) ?? null,
        release: (key: string) => originalPreloads.delete(key),
      };
    }
  `;
  const candidate = readFileSync(path.join(root, 'src/desktop/preloadSources.ts'), 'utf8');
  for (const [name, contents] of [
    ['baseline', baselineSource],
    ['candidate', candidate],
  ]) {
    const result = await build({
      stdin: { contents, loader: 'ts' },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
    });
    writeFileSync(path.join(temp, name + '.cjs'), result.outputFiles[0].contents);
  }
  // Approximately the size of Slack's original desktop preload; generated text
  // avoids bundling vendor source or relying on an installed Slack version.
  const payload =
    '/*' +
    Array.from({ length: 763945 }, (_, i) => String.fromCharCode(65 + ((i * 17 + (i % 31)) % 26))).join('') +
    '*/';
  writeFileSync(path.join(temp, 'fixture-preload.js'), payload);
  writeFileSync(path.join(temp, 'worker.cjs'), worker);
  const results = [];
  for (const count of [1, 2, 4]) {
    for (let repeat = 0; repeat < 3; repeat++) {
      for (const mode of repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
        const child = spawnSync(electron, ['--expose-gc', path.join(temp, 'worker.cjs'), mode, String(count)], {
          cwd: root,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          encoding: 'utf8',
          timeout: 30000,
        });
        if (child.status !== 0) throw Error(child.stderr || child.error || 'Benchmark worker failed');
        results.push({ repeat, ...JSON.parse(child.stdout) });
      }
    }
  }
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = [1, 2, 4].map((count) => ({
    count,
    ...Object.fromEntries(
      ['baseline', 'candidate'].map((mode) => {
        const rows = results.filter((row) => row.mode === mode && row.count === count);
        return [
          mode,
          {
            retainedHeapBytes: median(rows.map((row) => row.retainedHeapBytes)),
            releasedHeapBytes: median(rows.map((row) => row.releasedHeapBytes)),
            createMs: median(rows.map((row) => row.createMs)),
          },
        ];
      }),
    ),
  }));
  console.log(
    JSON.stringify(
      {
        scope: 'Isolated main-process source retention; not app RSS/PSS or startup latency.',
        baseline,
        sourceBytes: payload.length,
        repeatsPerArmAndWindowCount: 3,
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
