// bun scripts/bench/show-real-user.ts [baseline-ref]
// Exact plugin and TTL Cache, with deferred API responses and a fake clock.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Cache, ScopedStorage } from '../../src/app/api/storage.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourcePath = 'src/plugins/ShowRealUser/index.tsx';
const baselineRef = process.argv[2] ?? '8e1a66e';
async function load(source: string) {
  const result = await build({
    stdin: { contents: source, sourcefile: sourcePath, resolveDir: dirname(resolve(root, sourcePath)), loader: 'tsx' },
    tsconfig: resolve(root, 'tsconfig.json'),
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.text).toString('base64')}`))
    .default;
}
const baseline = await load(
  execFileSync('git', ['show', `${baselineRef}:${sourcePath}`], { cwd: root, encoding: 'utf8' }),
);
const candidate = await load(await readFile(resolve(root, sourcePath), 'utf8'));
async function drain() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

async function measure(Plugin: any, fail: boolean) {
  const previousTimeout = globalThis.setTimeout,
    previousClear = globalThis.clearTimeout;
  const timers = new Map<number, () => void>();
  let scheduled = 0,
    cleared = 0,
    refreshes = 0,
    cacheGets = 0,
    apiCalls = 0,
    loggedFailures = 0;
  const responses: (() => void)[] = [];
  globalThis.setTimeout = ((fn: () => void) => {
    timers.set(++scheduled, fn);
    return scheduled;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    cleared++;
    timers.delete(id);
  }) as unknown as typeof clearTimeout;
  const storage = new ScopedStorage({
    list: async () => [],
    read: async () => null,
    readAll: async () => ({}),
    write: async () => true,
    delete: async () => true,
    clear: async () => true,
  });
  const controller = new AbortController();
  const plugin = new Plugin(
    {
      signal: controller.signal,
      redux: { refresh: () => refreshes++ },
      userAPI(_method: string, params: { ts: string }) {
        apiCalls++;
        return new Promise((complete, reject) =>
          responses.push(() => {
            if (fail) reject(new Error('fixture failure'));
            else
              complete({
                messages: [
                  { ts: params.ts, bot_id: 'B08G06U6SJG', metadata: { event_payload: { source_user_id: 'U1' } } },
                ],
              });
          }),
        );
      },
      Cache(name: string, ttl: number) {
        const cache = new Cache(storage, name, ttl),
          get = cache.get.bind(cache);
        cache.get = (...args) => {
          cacheGets++;
          return get(...args);
        };
        return cache;
      },
    },
    {},
  );
  plugin.log = () => loggedFailures++;
  try {
    for (let cycle = 0; cycle < 101; cycle++) {
      for (let i = 0; i < 100; i++) assert.equal(plugin.senderOf('C', `${i}`), undefined);
      await drain();
    }
    for (const response of responses) response();
    await drain();
    for (let i = 0; i < 100; i++) assert.equal(plugin.senderOf('C', `${i}`), fail ? undefined : 'U1');
    const liveTimers = timers.size;
    const callbacks = [...timers.values()];
    timers.clear();
    for (const callback of callbacks) callback();
    return {
      messages: 100,
      renderCycles: 101,
      apiCalls,
      cacheGets,
      scheduled,
      cleared,
      liveTimers,
      refreshes,
      loggedFailures,
    };
  } finally {
    plugin.stop();
    controller.abort();
    globalThis.setTimeout = previousTimeout;
    globalThis.clearTimeout = previousClear;
  }
}
const results = [];
for (const fail of [false, true]) {
  const before = await measure(baseline, fail),
    after = await measure(candidate, fail);
  assert.equal(before.apiCalls, 100);
  assert.equal(after.apiCalls, 100);
  assert.equal(before.cacheGets, 10100);
  assert.equal(after.cacheGets, 100);
  if (fail) {
    assert.equal(before.loggedFailures, 10100);
    assert.equal(after.loggedFailures, 100);
  } else {
    assert.equal(before.scheduled, 10100);
    assert.equal(after.scheduled, 100);
    assert.equal(after.refreshes, 1);
  }
  results.push({ outcome: fail ? 'failure' : 'success', before, after });
}
console.log(
  JSON.stringify(
    {
      workload: '100 uncached relay messages read 101 times each before lookup completion',
      baselineRef,
      results,
      limitation:
        'Deterministic operation counts, not elapsed performance. The existing cache already deduplicates API calls; this removes duplicate continuations, timers, and failure logs.',
    },
    null,
    2,
  ),
);
