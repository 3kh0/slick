import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('./index.tsx', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'dialog-harness',
      setup(builder) {
        builder.onLoad({ filter: /localNameDialog\.ts$/ }, () => ({
          contents: 'export const openLocalNameDialog = (...args) => globalThis.openTestDialog(...args);',
          loader: 'js',
        }));
      },
    },
  ],
});
const { default: PrivateChannelMapper } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

test('double-click names locally through a modal, supports cancel/removal, and cleans up on stop', async () => {
  const globals = globalThis as any;
  const previous = {
    openTestDialog: globals.openTestDialog,
    document: globals.document,
    localStorage: globals.localStorage,
  };
  const listeners: ((event: any) => void)[] = [];
  const doc = {
    addEventListener: (type: string, listener: (event: any) => void, options: AddEventListenerOptions) => {
      assert.equal(type, 'dblclick');
      assert.equal(options.capture, true);
      listeners.push(listener);
    },
  };
  globals.document = doc;
  globals.localStorage = { getItem: () => null };
  const controller = new AbortController();
  const id = 'C0BU4KEH71D';
  const writes: unknown[] = [];
  const modals: any[] = [];
  let refreshes = 0;
  let closes = 0;
  globals.openTestDialog = (owner: unknown, options: any) => {
    assert.equal(owner, doc);
    modals.push(options);
    return {
      close: () => {
        closes++;
        options.onClose();
      },
    };
  };
  const plugin = new PrivateChannelMapper(
    {
      signal: controller.signal,
      storage: {
        get: async (key: string, fallback: unknown) => (key === 'localNames' ? { [id]: 'cis' } : fallback),
        set: async (key: string, value: unknown) => writes.push({ key, value }),
      },
      redux: { patchSlice: () => {}, refresh: () => refreshes++ },
      channels: { getCachedChannel: () => ({ name: 'cis' }) },
      patchComponent: () => {},
      onDocument: (listen: (document: unknown) => void) => listen(doc),
    },
    {},
  );
  const click = (listener: (event: any) => void, channelId = id) =>
    listener({
      target: { closest: () => ({ dataset: { slickPcmId: channelId }, ownerDocument: doc }) },
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  try {
    await plugin.start();
    assert.equal(listeners.length, 2);
    click(listeners[0]!, 'invalid');
    assert.equal(modals.length, 0);
    click(listeners[0]!);
    assert.equal(modals.at(-1).value, 'cis');
    // Opening another editor discards the unsubmitted value and closes the old one.
    click(listeners[1]!);
    assert.equal(closes, 1);
    assert.equal(modals.at(-1).value, 'cis');
    assert.deepEqual(writes, []);
    modals.at(-1).onSave('  local-cis  ');
    assert.deepEqual(writes, [{ key: 'localNames', value: { [id]: 'local-cis' } }]);
    assert.equal(refreshes, 2);
    click(listeners[0]!);
    assert.equal(modals.at(-1).value, 'local-cis');
    modals.at(-1).onSave('   ');
    assert.deepEqual(writes.at(-1), { key: 'localNames', value: {} });
    assert.equal(refreshes, 3);
    controller.abort();
    plugin.stop();
    assert.equal(closes, 3);
    modals.at(-1).onSave('after-stop');
    assert.equal(writes.length, 2);
  } finally {
    controller.abort();
    plugin.stop();
    Object.assign(globals, previous);
  }
});
