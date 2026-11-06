// Run with Bun: bun scripts/bench/message-history.ts <baseline-ref>
// Uses the installed Electron/V8 version and synthetic message timestamps.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

const baseline = process.argv[2] ?? 'HEAD^';
const file = 'src/app/slack/messageHistory.ts';
const directory = await mkdtemp(join(tmpdir(), 'slick-history-bench-'));
const require = createRequire(import.meta.url);
const electron = require('electron') as string;
try {
  const sources = {
    before: execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' }),
    after: await readFile(file, 'utf8'),
  };
  for (const [name, source] of Object.entries(sources)) {
    await writeFile(join(directory, `${name}.cjs`), transformSync(source, { loader: 'ts', format: 'cjs' }).code);
  }
  const worker = join(directory, 'worker.cjs');
  await writeFile(
    worker,
    `const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const methods = { before: require('./before.cjs').withTimestamps, after: require('./after.cjs').withTimestamps };
const timestamp = (i) => String(i).padStart(10, '0') + '.000000';
const cases = [
  { name: 'one addition', count: 1000, added: 1, excluded: 0 },
  { name: 'ten additions', count: 1000, added: 10, excluded: 0 },
  { name: 'medium history patch', count: 1000, added: 100, excluded: 50 },
  { name: 'large history patch', count: 1000, added: 1000, excluded: 500 },
  { name: 'outside loaded range', count: 1000, added: 1000, excluded: 0, offset: 3000 },
];
const results = [];
let checksum = 0;
for (const scenario of cases) {
  const history = { slices: [{ timestamps: Array.from({ length: scenario.count }, (_, i) => timestamp(i * 2)), start: timestamp(0), end: timestamp(scenario.count * 2) }] };
  const added = Array.from({ length: scenario.added }, (_, i) => timestamp(i * 2 + 1 + (scenario.offset || 0)));
  const excluded = Array.from({ length: scenario.excluded }, (_, i) => timestamp(i * 4));
  assert.deepEqual(methods.after(history, added, excluded), methods.before(history, added, excluded));
  for (const [variant, apply] of Object.entries(methods)) {
    const run = () => {
      const start = performance.now();
      for (let i = 0; i < 20; i++) checksum += apply(history, added, excluded)[0].timestamps.length;
      return performance.now() - start;
    };
    for (let i = 0; i < 3; i++) run();
    const samples = Array.from({ length: 5 }, run);
    results.push({ scenario: scenario.name, variant, calls: 20, medianMs: samples.toSorted((a, b) => a - b)[2], samples });
  }
}
console.log(JSON.stringify({ electron: process.versions.electron, v8: process.versions.v8, results, checksum, scope: 'Synthetic helper workload; not whole-client latency.' }, null, 2));
`,
  );
  process.stdout.write(
    execFileSync(electron, [worker], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
    }),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
