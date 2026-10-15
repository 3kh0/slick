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
  const errors: unknown[][] = [];
  const timers: (() => void)[] = [];
  const context = createContext({
    console: { ...console, error: (...args: unknown[]) => errors.push(args) },
    EventTarget,
    Event,
    setTimeout: (callback: () => void) => timers.push(callback),
    queueMicrotask,
    document: { querySelector: () => null },
  });
  runInContext(bundle.outputFiles[0]!.text, context);
  const { react, webpack } = context.Patching;
  webpack.installWebpackHooks();
  const core = {
    createElement(type: unknown, props: unknown, ...children: unknown[]) {
      return { type, props, children };
    },
    jsx(type: any, props: unknown, key?: unknown) {
      return { type, props, key };
    },
    jsxs(type: any, props: unknown, key?: unknown) {
      return { type, props, key };
    },
    Component() {},
    useState() {},
    useSyncExternalStore(_subscribe: unknown, read: () => unknown) {
      return read();
    },
    Fragment: Symbol.for('react.fragment'),
  };
  context.rspackChunkGantryV2.push([
    [1],
    {
      runtime(module: any) {
        module.exports = core;
      },
    },
  ]);
  const module = { exports: {} };
  context.rspackChunkGantryV2[0][1].runtime(module, module.exports, () => ({}));
  return {
    react,
    core,
    errors,
    timers,
    load(value: unknown) {
      const queue = context.rspackChunkGantryV2;
      const id = queue.length;
      queue.push([[id], { [id]: (loadedModule: any) => (loadedModule.exports = value) }]);
      const lateModule = { exports: {} };
      queue.at(-1)[1][id](lateModule, lateModule.exports, () => ({}));
    },
  };
}

test('component identities run matchers once and remain discoverable across cache invalidation', async () => {
  const { react, core } = fixture();
  function Unpatched() {}
  function Patched() {}
  const Memo = { $$typeof: Symbol.for('react.memo'), type: function Memoized() {} };
  const Forward = { $$typeof: Symbol.for('react.forward_ref'), render: function Forwarded() {} };
  const calls = new Map<unknown, number>();
  const waiting = react.waitForRenderedComponent('Patched');
  const Replacement = () => null;
  const remove = react.patchComponent(
    {
      filter(type: unknown) {
        calls.set(type, (calls.get(type) ?? 0) + 1);
        return type === Patched;
      },
    },
    () => Replacement,
  );

  for (let i = 0; i < 20; i++) {
    assert.equal(core.jsx(Unpatched, {}).type, Unpatched);
    assert.equal(core.jsx(Patched, {}).type, Replacement);
    assert.equal(core.jsx(Memo, {}).type, Memo);
    assert.equal(core.jsx(Forward, {}).type, Forward);
  }
  assert.equal(await waiting, Patched);
  assert.equal(react.getRenderedComponent('Unpatched'), Unpatched);
  assert.equal(react.getRenderedComponent('Memoized'), Memo);
  assert.equal(react.getRenderedComponent('Forwarded'), Forward);
  for (const type of [Unpatched, Patched, Memo, Forward]) assert.equal(calls.get(type), 1);

  const removeUnrelated = react.patchComponent('Other', () => () => null);
  assert.equal(core.jsx(Unpatched, {}).type, Unpatched);
  assert.equal(core.jsx(Patched, {}).type, Replacement);
  assert.equal(calls.get(Unpatched), 2);
  assert.equal(calls.get(Patched), 2);
  remove();
  assert.equal(core.jsx(Patched, {}).type, Patched);
  removeUnrelated();
});

test('stacked replacements retain identity, original bypass and component statics while patches change', () => {
  const { react, core } = fixture();
  function Target() {}
  Target.slackMetadata = { kind: 'message' };
  let firstCalls = 0;
  let secondCalls = 0;
  const removeFirst = react.patchComponent('Target', (Original: unknown) => {
    firstCalls++;
    return (props: unknown) => core.jsx(Original, props);
  });
  const removeSecond = react.patchComponent('Target', (Original: unknown) => {
    secondCalls++;
    return (props: unknown) => core.jsx(Original, props);
  });
  const props = { id: 'message' };
  const outer = core.jsx(Target, props).type;
  const inner = outer(props).type;
  assert.equal(inner(props).type, Target);
  assert.equal(outer.slackMetadata, Target.slackMetadata);

  const removeUnrelated = react.patchComponent('Other', () => () => null);
  assert.equal(core.jsx(Target, props).type, outer);
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 1);
  removeUnrelated();
  assert.equal(core.jsx(Target, props).type, outer);

  const bypass = { __original: true, id: 'original' };
  assert.equal(core.jsx(Target, bypass).type, Target);
  assert.equal(Object.hasOwn(bypass, '__original'), false);
  assert.equal(core.jsx(Target, props).type, outer);

  removeSecond();
  assert.equal(core.jsx(Target, props).type, inner);
  assert.equal(firstCalls, 1);
  removeFirst();
  assert.equal(core.jsx(Target, props).type, Target);
});

test('primitive replacement caches preserve host tags and React symbols through invalidation', () => {
  const { react, core } = fixture();
  for (const type of ['span', core.Fragment]) {
    let calls = 0;
    const remove = react.patchComponent({ filter: (candidate: unknown) => candidate === type }, (Original: any) => {
      calls++;
      return (props: unknown) => core.jsx(Original, props);
    });
    const replacement = core.jsx(type, {}).type;
    assert.notEqual(replacement, type);
    assert.equal(replacement({}).type, type);
    const removeUnrelated = react.patchComponent('Other', () => () => null);
    assert.equal(core.jsx(type, {}).type, replacement);
    assert.equal(calls, 1);
    removeUnrelated();
    remove();
    assert.equal(core.jsx(type, {}).type, type);
  }
});

test('a failed replacer is disabled without breaking surviving replacements or their caches', () => {
  const { react, core, errors } = fixture();
  function Target() {}
  let failures = 0;
  const Replacement = () => null;
  const removeFailing = react.patchComponent('Target', () => {
    failures++;
    throw new Error('patch failed');
  });
  const removeWorking = react.patchComponent('Target', () => Replacement);
  for (let i = 0; i < 10; i++) assert.equal(core.jsx(Target, {}).type, Replacement);
  assert.equal(failures, 1);
  assert.equal(errors.length, 1);
  const removeUnrelated = react.patchComponent('Other', () => () => null);
  assert.equal(core.jsx(Target, {}).type, Replacement);
  assert.equal(failures, 1);
  removeUnrelated();
  removeWorking();
  removeFailing();
  assert.equal(core.jsx(Target, {}).type, Target);
});

test('invalid element types reach React for its own diagnostics', () => {
  const { core } = fixture();
  for (const type of [null, undefined, false, 42]) assert.equal(core.jsx(type, {}).type, type);
});

test('lazy components scan missing exports once while keeping loaded components synchronous', async () => {
  const { react, load, timers, errors } = fixture();
  let reads = 0;
  load({
    get unrelated() {
      reads++;
      return function OtherComponent() {};
    },
  });
  reads = 0;
  const Lazy = react.lazyComponent('DeferredComponent');
  assert.equal(Lazy({ label: 'waiting' }), null);
  assert.equal(reads, 1);
  assert.equal(Lazy({ label: 'still waiting' }), null);
  assert.equal(reads, 1, 'later renders do not repeat discovery');
  function DeferredComponent() {}
  load({ DeferredComponent });
  await Promise.resolve();
  assert.equal(Lazy({ label: 'ready' }).type, DeferredComponent);
  for (const timer of timers) timer();
  assert.equal(errors.length, 0);

  const AlreadyLoaded = react.lazyComponent('DeferredComponent');
  assert.equal(AlreadyLoaded({ label: 'first render' }).type, DeferredComponent);
});

test('lazy components recover when their module arrives after the missing-component timeout', async () => {
  const { react, load, timers, errors } = fixture();
  const Lazy = react.lazyComponent('LateComponent');
  assert.equal(Lazy({}), null);
  assert.equal(timers.length, 1);
  timers[0]();
  assert.equal(Lazy({}).type.displayName, 'Missing(LateComponent)');
  assert.equal(errors.length, 1);

  function LateComponent() {}
  load({ LateComponent });
  await Promise.resolve();
  assert.equal(Lazy({}).type, LateComponent);
  assert.equal(errors.length, 1);
});
