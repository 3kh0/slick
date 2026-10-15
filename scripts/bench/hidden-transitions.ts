// bun scripts/bench/hidden-transitions.ts [baseline-ref]
// Deterministic scheduling counts, not a CPU or whole-application benchmark.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const file = 'src/plugins/Snappy/transitions.ts';
const baseline = execFileSync('git', ['show', `${process.argv[2] ?? '8e1a66e'}:${file}`], { encoding: 'utf8' });
const candidate = readFileSync(file, 'utf8');

async function measure(source: string) {
  let now = 0;
  let next = 0;
  const jobs = new Map<number, { at: number; callback: () => void }>();
  const listeners = new Set<() => void>();
  const counts = { timers: 0, idleCallbacks: 0, stylesheetReads: 0, ruleReads: 0, flushes: 0 };
  const schedule = (callback: () => void, delay: number) => {
    const id = ++next;
    jobs.set(id, { at: now + delay, callback });
    return id;
  };
  const sheets = Array.from({ length: 200 }, () => ({
    get cssRules() {
      counts.ruleReads++;
      return [];
    },
  }));
  const document = {
    hidden: false,
    querySelector: () => ({}),
    get styleSheets() {
      counts.stylesheetReads++;
      return sheets;
    },
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  const context = vm.createContext({
    module: { exports: {} },
    document,
    console,
    CSSStyleRule: class {
      selectorText = '';
    },
    performance: { now: () => now },
    setTimeout: (callback: () => void, delay: number) =>
      schedule(() => {
        counts.timers++;
        callback();
      }, delay),
    clearTimeout: (id: number) => jobs.delete(id),
    requestIdleCallback: (callback: (deadline: object) => void) =>
      schedule(() => {
        counts.idleCallbacks++;
        callback({ didTimeout: false, timeRemaining: () => 50 });
      }, 1),
    cancelIdleCallback: (id: number) => jobs.delete(id),
  });
  vm.runInContext((await transform(source, { loader: 'ts', format: 'cjs' })).code, context);
  const scanner = context.module.exports.overrideTransitions(() => {}, {
    visit: () => '',
    flush: () => counts.flushes++,
  });
  function advance(duration: number) {
    const end = now + duration;
    for (;;) {
      const first = [...jobs].toSorted((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > end) break;
      const [id, job] = first;
      now = job.at;
      jobs.delete(id);
      job.callback();
    }
    now = end;
  }
  advance(20_000); // Finish startup and enter the five-second rescan period.
  document.hidden = true;
  for (const listener of listeners) listener();
  for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] = 0;
  advance(60_000);
  const hidden = { ...counts };
  document.hidden = false;
  for (const listener of listeners) listener();
  advance(5_100);
  assert.ok(counts.stylesheetReads > hidden.stylesheetReads, 'visible scans resume');
  scanner.stop();
  assert.equal(jobs.size, 0);
  assert.equal(listeners.size, 0);
  return hidden;
}

const result = {
  fixture: '60 seconds hidden after startup; 200 synthetic stylesheets',
  baseline: await measure(baseline),
  candidate: await measure(candidate),
};
assert.ok(result.baseline.idleCallbacks > 0);
assert.deepEqual(Object.values(result.candidate), [0, 0, 0, 0, 0]);
console.log(JSON.stringify(result, null, 2));
