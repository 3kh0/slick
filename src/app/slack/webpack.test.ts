import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('./webpack.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'Webpack',
});

function fixture(exports: unknown[]) {
  const context = createContext({ console });
  runInContext(bundle.outputFiles[0].text, context);
  const api = context.Webpack;
  api.installWebpackHooks();
  const queue = context.webpackChunkwebapp;
  queue.push([
    [1],
    Object.fromEntries(
      exports.map((value, i) => [
        i,
        (module: any) => {
          module.exports = value;
        },
      ]),
    ),
  ]);
  for (const factory of Object.values(queue[0][1]) as any[]) {
    const module = { exports: {} };
    factory(module, module.exports, () => ({}));
  }
  return api;
}

test('single export lookups return a matching namespace without reading its getters', () => {
  let reads = 0;
  const namespace = {
    get member() {
      reads++;
      return {};
    },
  };
  const api = fixture([namespace]);
  assert.equal(
    api.getExport((value: unknown) => value === namespace),
    namespace,
  );
  assert.equal(reads, 0);
});

test('discovery handles throwing getters and predicates, function properties and shared exports', () => {
  const found = { target: true };
  let reads = 0;
  const namespace = Object.create({ inherited: { target: true } });
  Object.defineProperties(namespace, {
    bad: {
      enumerable: true,
      get() {
        throw new Error('not ready');
      },
    },
    good: {
      enumerable: true,
      get() {
        reads++;
        return found;
      },
    },
    duplicate: { enumerable: true, value: found },
  });
  const fn = Object.assign(() => {}, { extra: found });
  const api = fixture([null, namespace, fn]);
  const predicate = (value: any) => {
    if (!value) throw new Error('not an object');
    return value.target === true;
  };
  assert.equal(api.getExport(predicate), found);
  assert.equal(reads, 1);
  const all = api.getExport(predicate, true);
  assert.equal(all.length, 1);
  assert.equal(all[0], found);
  assert.equal(reads, 2);
  assert.equal(
    api.getExport((value: unknown) => value === fn),
    fn,
  );
  assert.equal(
    api.getExport(() => false),
    undefined,
  );
  assert.equal(api.getExport(() => false, true).length, 0);
});
