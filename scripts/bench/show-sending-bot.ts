// bun scripts/bench/show-sending-bot.ts [baseline-ref]
// Exact plugin + Cache + userAPI sources; fake time and fetch, no Slack login.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Cache, ScopedStorage } from '../../src/app/api/storage.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourcePath = 'src/plugins/ShowSendingBot/index.tsx';
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
const apiBundle = await build({
  entryPoints: [resolve(root, 'src/app/api/userAPI.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'synthetic-team',
      setup(builder) {
        builder.onLoad({ filter: /[/\\]slack[/\\]localConfig\.ts$/ }, () => ({
          contents: "export const getActiveTeam = () => ({ token: 'fixture-only', url: 'https://fixture.invalid/' });",
          loader: 'js',
        }));
      },
    },
  ],
});
const { userAPI } = await import(
  `data:text/javascript;base64,${Buffer.from(apiBundle.outputFiles[0]!.text).toString('base64')}`
);
async function drain() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

async function measure(Plugin: any) {
  const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
  const previousTimeout = globalThis.setTimeout,
    previousClear = globalThis.clearTimeout,
    previousFetch = globalThis.fetch;
  const timers = new Map<number, () => void>();
  let timerId = 0,
    refreshes = 0,
    cacheGets = 0,
    fetchCalls = 0;
  const responses: (() => void)[] = [];
  Object.defineProperty(globalThis, 'React', { configurable: true, value: { createContext: () => ({}) } });
  globalThis.setTimeout = ((fn: () => void) => {
    timers.set(++timerId, fn);
    return timerId;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout;
  globalThis.fetch = (() => {
    fetchCalls++;
    return new Promise((complete) =>
      responses.push(() =>
        complete({ ok: true, status: 200, json: async () => ({ ok: true, messages: {} }) } as Response),
      ),
    );
  }) as typeof fetch;
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
      userAPI,
      redux: { refresh: () => refreshes++ },
      Cache(name: string, ttl: number, max: number) {
        const cache = new Cache(storage, name, ttl, max),
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
  try {
    const messages = Array.from({ length: 100 }, (_, i) => ({ channel: `C${Math.floor(i / 20)}`, ts: `${i}` }));
    for (let cycle = 0; cycle < 101; cycle++) {
      for (const msg of messages) assert.equal(plugin.appIdOf(msg), undefined);
      const scheduled = [...timers.values()];
      timers.clear();
      for (const fn of scheduled) fn();
      await drain();
    }
    const pendingRequests = responses.length;
    for (const response of responses) response();
    await drain();
    for (const msg of messages) assert.equal(plugin.appIdOf(msg), undefined);
    assert.equal(timers.size, 0, 'resolved missing app IDs stay cached');
    return {
      messages: messages.length,
      renderCycles: 101,
      simulatedElapsedMs: 5050,
      pendingRequests,
      fetchCalls,
      cacheGets,
      refreshes,
    };
  } finally {
    controller.abort();
    plugin.stop();
    globalThis.setTimeout = previousTimeout;
    globalThis.clearTimeout = previousClear;
    globalThis.fetch = previousFetch;
    if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
    else Reflect.deleteProperty(globalThis, 'React');
  }
}
const before = await measure(baseline),
  after = await measure(candidate);
assert.equal(before.fetchCalls, 101);
assert.equal(after.fetchCalls, 1);
assert.equal(after.cacheGets, 100);
console.log(
  JSON.stringify(
    {
      workload: '100 uncached messages, five channels, repeated every 50 simulated ms while fetch is unresolved',
      baselineRef,
      before,
      after,
      limitation:
        'Deterministic source-level operation counts with mocked fetch; not real network traffic, latency, or whole-app performance.',
    },
    null,
    2,
  ),
);
