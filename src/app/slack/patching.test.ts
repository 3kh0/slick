import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  stdin: {
    contents:
      "export * as webpack from './src/app/slack/webpack.ts'; export * as react from './src/app/slack/react.tsx';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'iife',
  globalName: 'Patching',
});

function fixture() {
  const context = createContext({
    console,
    EventTarget,
    Event,
    setTimeout,
    queueMicrotask,
    document: { querySelector: () => null },
  });
  runInContext(bundle.outputFiles[0]!.text, context);
  const api = context.Patching;
  api.webpack.installWebpackHooks();
  const queue = context.rspackChunkGantryV2;
  const require = () => ({});
  const execute = (chunk: any) => {
    for (const factory of Object.values(chunk[1]) as any[]) {
      const module = { exports: {} };
      factory(module, module.exports, require);
    }
    chunk[2]?.(require);
  };
  return { context, api, queue, require, execute };
}

test('Gantry modules are intercepted before and after defineProperty installs the runtime push', () => {
  const { context, api, queue, require, execute } = fixture();
  let initialized = 0;
  const queued = [
    [1],
    {
      first(module: any) {
        initialized++;
        module.exports = { firstExport: true };
      },
    },
  ];
  assert.equal(queue.push(queued), 1);
  assert.equal(initialized, 0, 'queueing must not execute a module early');
  execute(queue[0]);
  assert.equal(initialized, 1);
  assert.ok(api.webpack.getExport((value: any) => value?.firstExport));
  const runtimePush = function (this: unknown, ...chunks: any[]) {
    assert.equal(this, queue);
    for (const chunk of chunks) execute(chunk);
    return 123;
  };
  Object.defineProperty(queue, 'push', { configurable: true, writable: true, value: runtimePush });
  const push = queue.push;
  assert.equal(queue.push, push, 'reading push must reuse a stable wrapper');
  const chunk = [
    [2],
    {
      second(module: any) {
        module.exports = { secondExport: true };
      },
    },
    (received: unknown) => assert.equal(received, require),
  ];
  assert.equal(queue.push(chunk), 123);
  assert.ok(api.webpack.getExport((value: any) => value?.secondExport));
  assert.equal(context.__slickWebpackRequire, require);
  assert.equal(api.webpack.stats().modules, 2);
});

test('runtime assignment and chunk-array reassignment retain module interception', () => {
  const { context, api, execute } = fixture();
  const replacement: any[] = [];
  context.webpackChunkwebapp = replacement;
  const queue = context.webpackChunkwebapp;
  queue.push = (...chunks: any[]) => {
    chunks.forEach(execute);
    return 9;
  };
  queue.push([
    [1],
    {
      replacement(module: any) {
        module.exports = { replacedQueue: true };
      },
    },
  ]);
  assert.ok(api.webpack.getExport((value: any) => value?.replacedQueue));
  context.webpackChunkwebapp = queue;
  assert.equal(context.webpackChunkwebapp, queue);
});

test('immutable native push descriptors remain valid and indexed writes still wrap queued modules', () => {
  const { api, queue, execute } = fixture();
  const nativePush = queue.push;
  Object.defineProperty(queue, 'push', { value: nativePush, configurable: false, writable: false });
  assert.equal(queue.push, nativePush);
  queue.push([
    [1],
    {
      frozen(module: any) {
        module.exports = { frozenQueue: true };
      },
    },
  ]);
  execute(queue[0]);
  assert.ok(api.webpack.getExport((value: any) => value?.frozenQueue));
});

test('re-exported React and JSX runtimes resolve an original component exactly once', async () => {
  const { api, queue, execute } = fixture();
  const core: any = {
    createElement(type: unknown, props: unknown, ...children: unknown[]) {
      return { type, props, children };
    },
    Component: function Component() {},
    useState() {},
    jsx(type: unknown, props: unknown, key: unknown) {
      return { type, props, key };
    },
    jsxs(type: unknown, props: unknown, key: unknown) {
      return { type, props, key };
    },
    Fragment: Symbol('Fragment'),
  };
  const namespace = () => {
    const exports = {};
    for (const key of Object.keys(core))
      Object.defineProperty(exports, key, {
        enumerable: true,
        configurable: true,
        get: () => core[key],
        set: (value) => {
          core[key] = value;
        },
      });
    return exports;
  };
  queue.push([
    [1],
    {
      alias1(module: any) {
        module.exports = namespace();
      },
    },
  ]);
  execute(queue[0]);
  const createElement = core.createElement;
  const jsx = core.jsx;
  const jsxs = core.jsxs;
  queue.push([
    [2],
    {
      alias2(module: any) {
        module.exports = namespace();
      },
    },
  ]);
  execute(queue[1]);
  await api.react.patchingReady;
  assert.equal(core.createElement, createElement);
  assert.equal(core.jsx, jsx);
  assert.equal(core.jsxs, jsxs);
  function Tabs() {}
  const dispose = api.react.patchComponent(
    'Tabs',
    (Original: unknown) => (props: unknown) => core.createElement(Original, props),
  );
  for (const render of [core.createElement, core.jsx, core.jsxs]) {
    const props = { example: true };
    const patched = render(Tabs, props, 'key');
    assert.notEqual(patched.type, Tabs);
    const original = patched.type(props);
    assert.equal(original.type, Tabs, 'rendering the original must not return the replacement again');
    assert.equal(original.props, props);
    assert.equal(render(Tabs, { __original: true }).type, Tabs);
  }
  dispose();
  assert.equal(core.createElement(Tabs, {}).type, Tabs);
});
