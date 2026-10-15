// bun scripts/bench/lazy-discovery.ts <baseline-ref>
// Counts actual namespace getter reads; does not claim whole-app startup time.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';

const baseline = process.argv[2] ?? 'HEAD^';
const files = ['src/app/slack/webpack.ts', 'src/app/slack/react.tsx'];
async function measure(before: boolean) {
  const sources = new Map(
    await Promise.all(
      files.map(
        async (file) =>
          [
            resolve(file),
            before
              ? execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' })
              : await readFile(file, 'utf8'),
          ] as const,
      ),
    ),
  );
  const result = await build({
    stdin: {
      contents:
        "export * as webpack from './src/app/slack/webpack.ts'; export * as react from './src/app/slack/react.tsx';",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'Runtime',
    plugins: [
      {
        name: 'benchmark-source',
        setup(builder) {
          builder.onLoad({ filter: /\/slack\/(webpack\.ts|react\.tsx)$/ }, ({ path }) => ({
            contents: sources.get(path)!,
            loader: path.endsWith('.tsx') ? 'tsx' : 'ts',
            resolveDir: resolve('src/app/slack'),
          }));
        },
      },
    ],
  });
  const context = createContext({
    console,
    EventTarget,
    Event,
    queueMicrotask,
    setTimeout: () => 0,
    document: { querySelector: () => null },
  });
  runInContext(result.outputFiles[0].text, context);
  const { webpack, react } = context.Runtime;
  webpack.installWebpackHooks();
  const queue = context.webpackChunkwebapp;
  function load(id: string, value: unknown) {
    queue.push([[id], { [id]: (module: any) => (module.exports = value) }]);
    const module = { exports: {} };
    queue.at(-1)[1][id](module, module.exports, () => ({}));
  }
  load('react', {
    createElement: (type: unknown, props: unknown) => ({ type, props }),
    Component() {},
    useState() {},
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  });
  let getterReads = 0;
  const namespace = {};
  for (let i = 0; i < 4; i++)
    Object.defineProperty(namespace, `entry${i}`, {
      enumerable: true,
      get: () => {
        getterReads++;
        return function OtherComponent() {};
      },
    });
  for (let i = 0; i < 10_000; i++) load(String(i), namespace);
  getterReads = 0;
  const missing = Array.from({ length: 10 }, (_, i) => react.lazyComponent(`Missing${i}`));
  for (const component of missing) assert.equal(component({}), null);
  const firstRenderReads = getterReads;
  for (const component of missing) assert.equal(component({}), null);
  assert.equal(getterReads, firstRenderReads, 'subsequent renders must not search again');
  function Present() {}
  load('present', { Present });
  const immediate = react.lazyComponent('Present');
  assert.equal(immediate({}).type, Present, 'loaded components must render synchronously');
  return { firstRenderReads, modules: 10_000, exportsPerModule: 4, missingComponents: 10 };
}
const before = await measure(true);
const after = await measure(false);
assert.equal(after.firstRenderReads * 2, before.firstRenderReads);
console.log(
  JSON.stringify(
    { before, after, scope: 'Synthetic registry; exact lazyComponent and webpack lookup paths.' },
    null,
    2,
  ),
);
