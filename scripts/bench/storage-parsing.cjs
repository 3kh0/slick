// bun scripts/bench/storage-parsing.cjs [baseline-ref]
// Renderer task responsiveness during synthetic archive JSON parsing.
// High-priority scheduler tasks stand in for queued interactive work; ordinary
// timers can be deferred behind scheduler.yield()'s prioritized continuations.
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { transform } = require('esbuild');

async function renderer(sources) {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const constructors = sources.map((source) => {
    const module = { exports: {} };
    new Function('module', source)(module);
    return module.exports.ScopedStorage;
  });
  const message = JSON.stringify({
    ts: '1700000000.000001',
    channel: 'synthetic',
    text: 'A saved message '.repeat(40),
    blocks: Array.from({ length: 32 }, (_, i) => ({
      type: 'section',
      text: { type: 'plain_text', text: `Block ${i}: ${'example '.repeat(20)}` },
    })),
  });
  const images = JSON.stringify(
    Array.from({ length: 3 }, () => ({ name: 'synthetic.webp', data: 'data:image/webp;base64,' + 'A'.repeat(65_536) })),
  );
  const fixtures = [
    { name: 'small-read', count: 32, value: message },
    { name: 'saved-messages', count: 1000, value: message },
    { name: 'image-archive', count: 128, value: images },
  ];
  const results = [];
  for (const fixture of fixtures) {
    const raw = Object.fromEntries(Array.from({ length: fixture.count }, (_, i) => [`entry:${i}`, fixture.value]));
    const samples = [[], []];
    for (let trial = 0; trial < 7; trial++) {
      for (const arm of trial % 2 ? [1, 0] : [0, 1]) {
        await pause(20);
        const Storage = constructors[arm];
        const storage = new Storage({ readAll: async () => raw });
        let last = performance.now();
        let maxGap = 0;
        let ticks = 0;
        let stopped = false;
        const beat = () => {
          if (stopped) return;
          const now = performance.now();
          maxGap = Math.max(maxGap, now - last);
          last = now;
          ticks++;
          void scheduler.postTask(beat, { priority: 'user-blocking', delay: 1 });
        };
        void scheduler.postTask(beat, { priority: 'user-blocking', delay: 1 });
        const start = performance.now();
        const out = await storage.entries();
        const elapsed = performance.now() - start;
        const ticksDuringParse = ticks;
        await pause(1);
        stopped = true;
        if (out.size !== fixture.count || JSON.stringify(out.get('entry:0')) !== fixture.value)
          throw new Error('Output mismatch');
        if (trial) samples[arm].push({ elapsed, maxGap, ticksDuringParse });
      }
    }
    const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
    results.push({
      fixture: fixture.name,
      records: fixture.count,
      jsonBytes: fixture.count * fixture.value.length,
      baseline: Object.fromEntries(
        ['elapsed', 'maxGap', 'ticksDuringParse'].map((key) => [key, median(samples[0].map((sample) => sample[key]))]),
      ),
      candidate: Object.fromEntries(
        ['elapsed', 'maxGap', 'ticksDuringParse'].map((key) => [key, median(samples[1].map((sample) => sample[key]))]),
      ),
      samples,
    });
  }
  return results;
}

async function main() {
  const file = 'src/app/api/storage.ts';
  const baseline = execFileSync('git', ['show', `${process.argv[2] ?? '8e1a66e'}:${file}`], { encoding: 'utf8' });
  const sources = [];
  for (const source of [baseline, readFileSync(file, 'utf8')])
    sources.push((await transform(source, { loader: 'ts', format: 'cjs' })).code);
  const dir = mkdtempSync(path.join(tmpdir(), 'slick-storage-parsing-'));
  try {
    const expression = `(${renderer.toString()})(${JSON.stringify(sources)})`;
    const worker = path.join(dir, 'worker.cjs');
    writeFileSync(
      worker,
      `
      const { app, BrowserWindow } = require('electron');
      app.setPath('userData', ${JSON.stringify(path.join(dir, 'profile'))});
      app.whenReady().then(async () => {
        const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
        try {
          await window.loadURL('about:blank');
          const results = await window.webContents.executeJavaScript(${JSON.stringify(expression)});
          console.log(JSON.stringify({ electron: process.versions.electron, results }, null, 2));
        } catch (error) { console.error(error); process.exitCode = 1; }
        finally { window.destroy(); app.quit(); }
      });
    `,
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [worker], { env, encoding: 'utf8', timeout: 60_000 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Electron benchmark failed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
