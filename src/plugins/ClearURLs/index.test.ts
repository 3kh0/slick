import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('./index.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { default: ClearURLs } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

test('paste cleanup watches the main document immediately and removes hooks on disable', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let prepared: any;
  const prototype = {
    preparePastedDelta(args: unknown) {
      prepared = args;
    },
  };
  const original = prototype.preparePastedDelta;
  const clipboard = Object.create(prototype);
  const listeners = new Map<string, unknown>();
  const doc = {
    activeElement: { closest: () => ({ __quill: { getModule: () => clipboard } }) },
    addEventListener(name: string, callback: unknown) {
      listeners.set(name, callback);
    },
    removeEventListener(name: string, callback: unknown) {
      assert.equal(listeners.get(name), callback);
      listeners.delete(name);
    },
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  let childWatcher: unknown;
  const plugin = new ClearURLs(
    {
      onMessageSendDelta() {},
      onDocument(callback: unknown) {
        childWatcher = callback;
      },
      main: { call: async () => null },
      signal: new AbortController().signal,
    },
    { extraRules: 'utm_source' },
  );
  plugin.log = () => {};
  plugin.start();
  await Promise.resolve();
  assert.ok(listeners.has('focusin'));
  assert.equal(typeof childWatcher, 'function');
  class Delta {
    ops: unknown[];
    constructor(ops: unknown[]) {
      this.ops = ops;
    }
  }
  clipboard.preparePastedDelta({ pastedDelta: new Delta([{ insert: 'https://example.test/?utm_source=slack' }]) });
  assert.equal(prepared.pastedDelta.ops[0].insert, 'https://example.test/');
  plugin.stop();
  assert.equal(listeners.size, 0);
  assert.equal(prototype.preparePastedDelta, original);
});
