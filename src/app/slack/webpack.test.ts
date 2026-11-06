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
  return {
    ...api,
    load(value: unknown, id = 'late') {
      queue.push([[id], { [id]: (module: any) => (module.exports = value) }]);
      const module = { exports: {} };
      queue.at(-1)[1][id](module, module.exports, () => ({}));
    },
  };
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

test('primitive exports remain whole values while function members stay discoverable', () => {
  const member = {};
  const fn = Object.assign(() => {}, { member });
  const primitives = ['asset-url', 42, false, Symbol('export'), 1n, null, undefined];
  const api = fixture([...primitives, fn]);
  for (const primitive of primitives) {
    assert.deepEqual([...api.getExport((value: unknown) => value === primitive, true)], [primitive]);
  }
  assert.equal(
    api.getExport((value: unknown) => value === 'a'),
    undefined,
  );
  assert.deepEqual([...api.getExport((value: unknown) => typeof value === 'string', true)], ['asset-url']);
  assert.equal(
    api.getExport((value: unknown) => value === member),
    member,
  );
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

test('synchronous-or-wait discovery scans a miss once and resolves when a matching module arrives', async () => {
  let reads = 0;
  const namespace = {
    get member() {
      reads++;
      return 'other';
    },
  };
  const api = fixture([namespace]);
  const pending = api.getExportOrWait((value: unknown) => value === 'wanted');
  assert.equal(pending.found, false);
  assert.equal(reads, 1);
  api.load({ value: 'wanted' });
  assert.equal(await pending.promise, 'wanted');
  const immediate = api.getExportOrWait((value: unknown) => value === namespace);
  assert.equal(immediate.found, true);
  assert.equal(immediate.value, namespace);
  assert.equal(reads, 1, 'matching the namespace still avoids invoking its getter');
});

test('ordinary waitForExport retains its one-scan matcher behavior', async () => {
  const marker = {};
  const api = fixture([marker]);
  let calls = 0;
  const waiting = api.waitForExport((value: unknown) => value === marker && ++calls === 2);
  assert.equal(calls, 1);
  api.load(marker);
  assert.equal(await waiting, marker);
  assert.equal(calls, 2);
});
