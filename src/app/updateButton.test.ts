import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import type { UpdateStatus } from './updateStatus.ts';

const code = transformSync(readFileSync(new URL('./updateButton.ts', import.meta.url), 'utf8'), {
  loader: 'ts',
  format: 'cjs',
}).code;

function fixture() {
  let resolveStatus!: (status: UpdateStatus) => void;
  const initialStatus = new Promise<UpdateStatus>((resolve) => (resolveStatus = resolve));
  let receive!: (status: UpdateStatus) => void;
  let pagehide!: () => void;
  let mount!: () => void;
  let observing = false;
  let unsubscribed = false;
  let headerPresent = true;
  let button: any;
  const flex = {};
  const right = { contains: (node: unknown) => node === flex };
  const help = {
    parentElement: flex,
    closest: () => right,
    before: (node: any) => (node.isConnected = true),
  };
  const context = {
    module: { exports: {} as any },
    require: () => ({ setStyle() {} }),
    console,
    MutationObserver: class {
      constructor(callback: () => void) {
        mount = callback;
      }
      observe() {
        observing = true;
      }
      disconnect() {
        observing = false;
      }
    },
    document: {
      documentElement: {},
      querySelector: () => (headerPresent ? help : null),
      createElement(tag: string) {
        const node = {
          isConnected: false,
          dataset: {},
          style: { setProperty() {} },
          append() {},
          addEventListener() {},
          setAttribute() {},
          remove() {
            this.isConnected = false;
          },
        };
        if (tag === 'button') button = node;
        return node;
      },
    },
    getComputedStyle: () => ({ display: 'flex' }),
    window: { addEventListener: (_name: string, callback: () => void) => (pagehide = callback) },
  };
  runInNewContext(code, context);
  context.module.exports.installUpdateButton({
    getUpdateStatus: () => initialStatus,
    activateUpdate: async () => {},
    onUpdateStatus(callback: typeof receive) {
      receive = callback;
      return () => (unsubscribed = true);
    },
  });
  return {
    get observing() {
      return observing;
    },
    get connected() {
      return button.isConnected;
    },
    get unsubscribed() {
      return unsubscribed;
    },
    receive: (status: UpdateStatus) => receive(status),
    async initial(status: UpdateStatus) {
      resolveStatus(status);
      await initialStatus;
    },
    replaceHeader(present: boolean) {
      headerPresent = present;
      button.isConnected = false;
      if (observing) mount();
    },
    hide: () => pagehide(),
  };
}

test('idle updates avoid DOM observation, then mount and follow title-bar replacements when available', async () => {
  const f = fixture();
  assert.equal(f.observing, false);
  await f.initial({ state: 'idle' });
  assert.equal(f.observing, false);
  assert.equal(f.connected, false);

  f.receive({ state: 'ready' });
  assert.equal(f.observing, true);
  assert.equal(f.connected, true);
  f.replaceHeader(false);
  assert.equal(f.connected, false);
  f.replaceHeader(true);
  assert.equal(f.connected, true);

  f.receive({ state: 'idle' });
  assert.equal(f.observing, false);
  assert.equal(f.connected, false);
  f.receive({ state: 'downloading', percent: 20 });
  assert.equal(f.observing, true);
  assert.equal(f.connected, true);
  f.hide();
  assert.equal(f.observing, false);
  assert.equal(f.unsubscribed, true);
});

test('a stale initial response cannot override a newer idle status', async () => {
  const f = fixture();
  f.receive({ state: 'idle' });
  await f.initial({ state: 'ready' });
  assert.equal(f.observing, false);
  assert.equal(f.connected, false);
});

test('a pending initial response and queued status delivery cannot restart observation after pagehide', async () => {
  const f = fixture();
  f.hide();
  await f.initial({ state: 'ready' });
  f.receive({ state: 'downloading' });
  assert.equal(f.observing, false);
  assert.equal(f.connected, false);
  assert.equal(f.unsubscribed, true);
});
