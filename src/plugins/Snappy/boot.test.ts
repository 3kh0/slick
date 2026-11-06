import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';
import { shouldOptimizeStateTracking } from './boot.ts';
import type { SlickBridge } from '../../app/bridge.ts';

type Context = Pick<SlickBridge, 'loader' | 'safeMode' | 'initialSettings'>;
const enabled = JSON.stringify({ plugins: { Snappy: { optimizeStateTracking: true } } });
const desktop: Context = { loader: 'electron', safeMode: false, initialSettings: enabled };

test('early native state tracking requires a usable fresh settings snapshot', () => {
  assert.equal(shouldOptimizeStateTracking(desktop, false), true);
  for (const initialSettings of [
    undefined,
    '',
    '{',
    'null',
    '[]',
    'true',
    '{"plugins":[]}',
    '{"plugins":{"Snappy":null}}',
    '{"plugins":{"Snappy":{"optimizeStateTracking":"true"}}}',
    '{"plugins":{"Snappy":{"optimizeStateTracking":false}}}',
    '{"enabled":"false","plugins":{"Snappy":{"optimizeStateTracking":true}}}',
    '{"enabled":null,"plugins":{"Snappy":{"optimizeStateTracking":true}}}',
    '{"plugins":{"Snappy":{"enabled":"false","optimizeStateTracking":true}}}',
    '{"plugins":{"Snappy":{"enabled":0,"optimizeStateTracking":true}}}',
  ]) {
    assert.equal(shouldOptimizeStateTracking({ ...desktop, initialSettings }, false), false);
  }
});

test('first-run and existing settings receive the default while explicit opt-outs survive', () => {
  for (const initialSettings of [
    '{}',
    '{"plugins":{}}',
    '{"plugins":{"Snappy":{}}}',
    '{"plugins":{"Snappy":{"optimizeResize":true}}}',
  ]) {
    assert.equal(shouldOptimizeStateTracking({ ...desktop, initialSettings }, false), true);
  }
  for (const initialSettings of [
    '{"enabled":false}',
    '{"plugins":{"Snappy":{"enabled":false}}}',
    '{"plugins":{"Snappy":{"optimizeStateTracking":false}}}',
  ]) {
    assert.equal(shouldOptimizeStateTracking({ ...desktop, initialSettings }, false), false);
  }
});

test('safe mode, global and plugin kill switches prevent early state overrides', () => {
  assert.equal(shouldOptimizeStateTracking({ ...desktop, safeMode: true }, false), false);
  for (const stored of [
    { enabled: false, plugins: { Snappy: { optimizeStateTracking: true } } },
    { plugins: { Snappy: { enabled: false, optimizeStateTracking: true } } },
  ]) {
    assert.equal(shouldOptimizeStateTracking({ ...desktop, initialSettings: JSON.stringify(stored) }, false), false);
  }
});

test('only early desktop and userscript loaders can select native state fast paths', () => {
  for (const loader of ['electron', 'userscript', 'extension'] as const) {
    assert.equal(shouldOptimizeStateTracking({ ...desktop, loader }, false), loader !== 'extension');
    assert.equal(shouldOptimizeStateTracking({ ...desktop, loader }, true), false);
  }
});

test('each document uses its current snapshot, including an external disable', () => {
  assert.equal(shouldOptimizeStateTracking(desktop, false), true);
  const next = { ...desktop, initialSettings: '{"enabled":false}' };
  assert.equal(shouldOptimizeStateTracking(next, false), false);
  assert.equal(shouldOptimizeStateTracking({ ...desktop, initialSettings: undefined }, false), false);
});

const bundle = await build({
  stdin: {
    contents: "export * as boot from './boot.ts'; export * as webpack from '../../app/slack/webpack.ts';",
    resolveDir: new URL('.', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'StateBoot',
});

function eagerConsumerFixture(bridge: Context, slackAlreadyLoaded = false) {
  // Every document has a fresh registry, including the persistent boot patcher.
  const context = createContext({ console });
  runInContext(bundle.outputFiles[0]!.text, context);
  const { boot, webpack } = context.StateBoot;
  boot.installStateTrackingOptimization(bridge, slackAlreadyLoaded);
  webpack.installWebpackHooks();

  const toggles = {
    ReduxSharedStateDescriptors: 'redux_shared_state_descriptors',
    HotPathStableShapes: 'hot_path_stable_shapes',
  };
  const gates = new Function(
    'readToggle',
    'toggles',
    `return {
      shared: function shouldShareReduxStateDescriptors() { return readToggle(toggles.ReduxSharedStateDescriptors); },
      stable: function shouldUseHotPathStableShapes() { return readToggle(toggles.HotPathStableShapes); }
    };`,
  )(() => false, toggles);
  let enumReads = 0;
  const originalNamespace = Object.create(null, {
    flags: {
      enumerable: true,
      get() {
        enumReads++;
        return toggles;
      },
    },
    shared: { enumerable: true, get: () => gates.shared },
    stable: { enumerable: true, get: () => gates.stable },
  });
  const initialized: string[] = [];
  const queue = context.rspackChunkGantryV2;
  queue.push([
    [1],
    {
      gates(module: any) {
        initialized.push('gates');
        module.exports = originalNamespace;
      },
      consumer(module: any, _exports: any, loadModule: (id: string) => any) {
        const nativeGates = loadModule('gates');
        // Some Slack modules capture these choices when their factory executes.
        module.exports = { shared: nativeGates.shared(), stable: nativeGates.stable() };
        initialized.push('consumer');
      },
    },
  ]);
  const modules = new Map<string, { exports: any }>();
  function require(id: string): any {
    let module = modules.get(id);
    if (!module) {
      module = { exports: {} };
      modules.set(id, module);
      queue[0][1][id](module, module.exports, require);
    }
    return module.exports;
  }
  const captured = require('consumer');
  return { captured, namespace: require('gates'), originalNamespace, initialized, enumReads, webpack };
}

test('early boot patches real chunk exports before an eager consumer captures native gates', () => {
  const fixture = eagerConsumerFixture(desktop);
  assert.deepEqual(fixture.initialized, ['gates', 'consumer']);
  assert.deepEqual(fixture.captured, { shared: true, stable: true });
  assert.notEqual(fixture.namespace, fixture.originalNamespace);
  assert.equal(fixture.originalNamespace.shared(), false);
  assert.equal(fixture.originalNamespace.stable(), false);
  for (const name of ['shouldShareReduxStateDescriptors', 'shouldUseHotPathStableShapes']) {
    const discovered = fixture.webpack.getExport((value: any) => typeof value === 'function' && value.name === name);
    assert.equal(discovered(), true);
  }
});

test('disabled and ineligible boots do not inspect or replace native chunk exports', () => {
  const scenarios: [Context, boolean][] = [
    [{ ...desktop, initialSettings: undefined }, false],
    [{ ...desktop, initialSettings: '{"plugins":{"Snappy":{"optimizeStateTracking":false}}}' }, false],
    [{ ...desktop, initialSettings: '{"enabled":false}' }, false],
    [{ ...desktop, initialSettings: '{"plugins":{"Snappy":{"enabled":false,"optimizeStateTracking":true}}}' }, false],
    [{ ...desktop, safeMode: true }, false],
    [{ ...desktop, loader: 'extension' }, false],
    [desktop, true],
  ];
  for (const [bridge, slackAlreadyLoaded] of scenarios) {
    const fixture = eagerConsumerFixture(bridge, slackAlreadyLoaded);
    assert.deepEqual(fixture.initialized, ['gates', 'consumer']);
    assert.deepEqual(fixture.captured, { shared: false, stable: false });
    assert.equal(fixture.namespace, fixture.originalNamespace);
    assert.equal(fixture.enumReads, 0);
  }
});
