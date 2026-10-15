import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  stdin: {
    contents:
      "export * as webpack from './src/app/slack/webpack.ts'; export * as redux from './src/app/slack/redux.ts';",
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
  const { redux, webpack } = context.Patching;
  webpack.installWebpackHooks();
  function createStore(initialState: any) {
    let state = initialState;
    return {
      getState: () => state,
      dispatch(action: any) {
        if (action.type === 'replace') state = action.value;
        return action;
      },
      subscribe: () => () => {},
    };
  }
  context.rspackChunkGantryV2.push([
    [1],
    {
      stores(module: any) {
        module.exports = { createStore };
      },
    },
  ]);
  const module: any = { exports: {} };
  context.rspackChunkGantryV2[0][1].stores(module, module.exports, () => ({}));
  return { redux, createStore: module.exports.createStore as typeof createStore };
}

test('state patches memoize per store, invalidate all stores on refresh and never mutate raw state', () => {
  const { redux, createStore } = fixture();
  const rawA = { count: 1 };
  const rawB = { count: 2 };
  const a = createStore(rawA);
  const b = createStore(rawB);
  let calls = 0;
  let increment = 10;
  const remove = redux.patchState((state: any) => {
    calls++;
    return { ...state, count: state.count + increment };
  });
  const patchedA = a.getState();
  const patchedB = b.getState();
  assert.equal(a.getState(), patchedA);
  assert.equal(b.getState(), patchedB);
  assert.equal(calls, 2);

  increment = 20;
  redux.refresh();
  const refreshedA = a.getState();
  const refreshedB = b.getState();
  assert.notEqual(refreshedA, patchedA);
  assert.notEqual(refreshedB, patchedB);
  assert.equal(refreshedA.count, 21);
  assert.equal(refreshedB.count, 22);
  assert.equal(calls, 4);
  assert.deepEqual(rawA, { count: 1 });
  assert.deepEqual(rawB, { count: 2 });

  const replacement = { count: 3 };
  a.dispatch({ type: 'replace', value: replacement });
  assert.equal(a.getState().count, 23);
  assert.equal(b.getState(), refreshedB);
  assert.equal(calls, 5);
  remove();
  assert.equal(a.getState(), replacement);
  assert.equal(b.getState(), rawB);
  assert.equal(calls, 5);
});

test('stores sharing one raw state keep separate patch results and handle undefined states', () => {
  const { redux, createStore } = fixture();
  const shared = {};
  const a = createStore(shared);
  const b = createStore(shared);
  const empty = createStore(undefined);
  const remove = redux.patchState((raw: unknown) => ({ raw }));
  assert.notEqual(a.getState(), b.getState());
  assert.equal(empty.getState().raw, undefined);
  assert.equal(empty.getState(), empty.getState());
  remove();
  assert.equal(empty.getState(), undefined);
});
