import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/app/api/resize.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'ResizeGate',
});

function fixture() {
  let listener: (event: unknown) => void;
  let timer: (() => void) | undefined;
  class NativeResizeObserver {
    callback: (entries: unknown[], observer: NativeResizeObserver) => void;
    constructor(callback: NativeResizeObserver['callback']) {
      this.callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    deliver(entries: unknown[]) {
      this.callback(entries, this);
    }
  }
  const window = {
    ResizeObserver: NativeResizeObserver,
    addEventListener(_name: string, callback: typeof listener) {
      listener = callback;
    },
    dispatchEvent(event: unknown) {
      listener(event);
    },
  };
  const context = createContext({
    window,
    console,
    UIEvent: Event,
    reportError: (error: unknown) => {
      throw error;
    },
    setTimeout: (callback: () => void) => {
      timer = callback;
      return 1;
    },
    clearTimeout: () => {
      timer = undefined;
    },
  });
  runInContext(bundle.outputFiles[0]!.text, context);
  const api = context.ResizeGate;
  api.installResizeGate();
  const stop = api.deferResizeWork({ quietMs: 150 });
  return {
    window,
    stop,
    hold() {
      window.dispatchEvent({ stopImmediatePropagation() {} });
    },
    flush() {
      const callback = timer;
      timer = undefined;
      callback?.();
    },
  };
}

test('resize holds deliver the latest entry once without retaining entries across drags', () => {
  const f = fixture();
  const batches: unknown[][] = [];
  const observer = new f.window.ResizeObserver((entries) => batches.push(Array.from(entries)));
  const a = {},
    b = {};
  const first = { target: a, height: 1 };
  const latest = { target: a, height: 2 };
  const secondDrag = { target: b, height: 3 };
  f.hold();
  observer.deliver([first]);
  observer.deliver([latest]);
  assert.equal(batches.length, 0);
  f.flush();
  assert.deepEqual(batches, [[latest]]);
  f.hold();
  observer.deliver([secondDrag]);
  f.flush();
  assert.deepEqual(batches, [[latest], [secondDrag]]);
  f.stop();
});

test('unobserving all held targets or disconnecting does not deliver an empty or stale batch', () => {
  const f = fixture();
  const batches: unknown[][] = [];
  const observer = new f.window.ResizeObserver((entries) => batches.push(Array.from(entries)));
  const target = {};
  f.hold();
  observer.deliver([{ target }]);
  (observer.unobserve as (target: object) => void)(target);
  f.flush();
  assert.equal(batches.length, 0);
  f.hold();
  observer.deliver([{ target }]);
  observer.disconnect();
  f.flush();
  assert.equal(batches.length, 0);
  f.stop();
});

test('removing the last resize gate flushes pending entries and restores immediate delivery', () => {
  const f = fixture();
  const batches: unknown[][] = [];
  const observer = new f.window.ResizeObserver((entries) => batches.push(Array.from(entries)));
  const first = { target: {} },
    second = { target: {} };
  f.hold();
  observer.deliver([first]);
  f.stop();
  observer.deliver([second]);
  assert.deepEqual(batches, [[first], [second]]);
});
