import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import type { SlickBridge } from '../app/bridge.ts';

// Exercise the real preload's async ordering without launching Electron.
const preload = transformSync(readFileSync(new URL('./preload.ts', import.meta.url), 'utf8'), {
  loader: 'ts',
  format: 'cjs',
  target: 'es2022',
}).code;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture(
  initial: Promise<unknown>,
  safeMode: unknown = false,
  originalPreload = 'void 0',
  argv: string[] = [],
) {
  const html = deferred<unknown>();
  const parsed = deferred<void>();
  const ready = deferred<void>();
  const calls: string[] = [];
  const writes: string[] = [];
  const lifecycle: string[] = [];
  const exposedValues = new Map<string, unknown>();
  const recovery = new Map<string, string>();
  let reloads = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let nextTimer = 0;
  let exposed: { claim(): SlickBridge | null } | undefined;
  let liveSettings = '{}';
  const ipc = {
    invoke(channel: string, method?: string) {
      calls.push(method ? `${channel}:${method}` : channel);
      if (channel === 'slick:get-original-preload') return Promise.resolve(originalPreload);
      if (channel === 'slick:get-app-url') return Promise.resolve('slick://app/slick.js');
      if (channel === 'slick:get-paths') return Promise.resolve({});
      if (channel === 'slick:get-safe-mode') return Promise.resolve(safeMode);
      if (channel === 'slick:rpc' && method === 'readBootSettings') return initial;
      if (channel === 'slick:rpc' && method === 'readSettings') return Promise.resolve(liveSettings);
      throw new Error(`Unexpected preload request: ${channel}:${method}`);
    },
    sendSync: () => null,
    send(_channel: string, event: string) {
      lifecycle.push(event);
      if (event === 'preload.ready') ready.resolve();
      if (event === 'preload.failed') ready.reject(new Error('Preload failed'));
    },
    on() {},
    removeListener() {},
  };
  const originalScript = {
    src: 'https://app.slack.com/native.js',
    textContent: '',
    getAttribute: () => null,
    remove() {},
  };
  const replacement = {
    head: { appendChild() {} },
    body: {},
    documentElement: { outerHTML: '<html>replacement</html>' },
    querySelector: () => originalScript,
    querySelectorAll: (selector: string) => (selector === 'script' ? [originalScript] : []),
    createElement: () => ({ setAttribute() {} }),
  };
  const exports = {};
  runInNewContext(preload, {
    require(id: string) {
      if (id === 'electron')
        return {
          ipcRenderer: ipc,
          contextBridge: {
            exposeInMainWorld(name: string, value: typeof exposed) {
              lifecycle.push(`expose:${name}`);
              exposedValues.set(name, value);
              if (name === 'SlickBridge') exposed = value;
            },
          },
        };
      if (id.endsWith('/accounts.ts')) return { applyPendingAccountSwitch() {}, PENDING_ACCOUNT_SWITCH_KEY: 'pending' };
      if (id.endsWith('/signInButton.ts')) return { installCookieSignInButton() {} };
      if (id.endsWith('/liteMode.ts')) return { LITE_ARG: '--slick-lite' };
      throw new Error(`Unexpected preload import: ${id}`);
    },
    console,
    process: { argv },
    module: { exports },
    exports,
    arguments: ['preload-argument'],
    URL,
    setTimeout(callback: () => void, delay: number) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
    location: {
      hostname: 'app.slack.com',
      pathname: '/client/T/C',
      href: 'https://app.slack.com/client/T/C',
      origin: 'https://app.slack.com',
      reload() {
        reloads++;
      },
    },
    sessionStorage: {
      getItem: (key: string) => recovery.get(key) ?? null,
      removeItem: (key: string) => recovery.delete(key),
      setItem: (key: string, value: string) => recovery.set(key, value),
    },
    document: {
      open() {},
      close() {},
      write(value: string) {
        writes.push(value);
      },
    },
    fetch() {
      calls.push('fetch');
      return html.promise;
    },
    DOMParser: class {
      parseFromString() {
        parsed.resolve();
        return replacement;
      }
    },
  });
  return {
    calls,
    writes,
    lifecycle,
    exposedValues,
    recovery,
    reloads: () => reloads,
    parsed: parsed.promise,
    ready: ready.promise,
    exposed: () => exposed,
    pendingTimers: () => timers.size,
    expireSettingsRead() {
      assert.equal(timers.size, 1);
      for (const [id, timer] of timers) {
        assert.equal(timer.delay, 500);
        timers.delete(id);
        timer.callback();
      }
    },
    setLiveSettings(text: string) {
      liveSettings = text;
    },
    resolveHtml() {
      html.resolve({
        ok: true,
        url: 'https://app.slack.com/client/T/C',
        headers: { get: () => 'text/html', has: () => false },
        text: async () => '<html><head><script src="native.js"></script></head><body></body></html>',
      });
    },
  };
}

test('original preload retains its bindings and runs before the bridge is exposed', async () => {
  const f = fixture(
    Promise.resolve('{}'),
    false,
    `require('electron').contextBridge.exposeInMainWorld('OriginalPreload', {
      processAvailable: Array.isArray(process.argv),
      sharedExports: module.exports === exports,
      sameThis: this === globalThis,
      argument: arguments[0],
    });`,
  );
  f.resolveHtml();
  await f.ready;
  const original = f.exposedValues.get('OriginalPreload') as Record<string, unknown>;
  assert.equal(original.processAvailable, true);
  assert.equal(original.sharedExports, true);
  assert.equal(original.sameThis, true);
  assert.equal(original.argument, 'preload-argument');
  assert.ok(f.lifecycle.indexOf('expose:OriginalPreload') < f.lifecycle.indexOf('preload.original-ready'));
  assert.ok(f.lifecycle.indexOf('preload.original-ready') < f.lifecycle.indexOf('expose:SlickBridge'));
  assert.equal(f.writes.length, 2);
});

test('lite mode skips the Slack preload and still exposes the bridge', async () => {
  const f = fixture(Promise.resolve('{}'), false, 'throw new Error("must not run")', ['--slick-lite']);
  f.resolveHtml();
  await f.ready;
  assert.ok(!f.calls.includes('slick:get-original-preload'));
  assert.ok(f.lifecycle.includes('expose:SlickBridge'));
  assert.equal(f.reloads(), 0);
  assert.equal(f.writes.length, 2);
});

test('an original preload failure still reloads stock Slack before exposing the bridge', async () => {
  const f = fixture(Promise.resolve('{}'), false, 'throw new Error("original preload failed")');
  await assert.rejects(f.ready, /Preload failed/);
  assert.equal(f.exposed(), undefined);
  assert.equal(f.writes.length, 1);
  assert.equal(f.recovery.get('slick:preload-recovery'), '1');
  assert.equal(f.reloads(), 1);
});

test('preload starts settings beside HTML and exposes the snapshot before committing Slack', async () => {
  const settings = deferred<unknown>();
  const f = fixture(settings.promise);
  assert.ok(f.calls.includes('fetch'));
  assert.ok(f.calls.includes('slick:rpc:readBootSettings'));
  assert.equal(f.calls.includes('slick:rpc:readSettings'), false);
  f.resolveHtml();
  await f.parsed;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.exposed(), undefined, 'the bridge cannot be claimed before boot settings settle');
  assert.equal(f.writes.length, 1, 'only the initial blank document has been written');
  const snapshot = '{"enabled":false}';
  settings.resolve(snapshot);
  await f.ready;
  const bridge = f.exposed()!.claim()!;
  assert.equal(bridge.initialSettings, snapshot);
  assert.equal(f.pendingTimers(), 0);
  assert.equal(f.writes.length, 2);
  assert.equal(f.exposed()!.claim(), null);
  f.setLiveSettings('{"enabled":true}');
  assert.equal(await bridge.readSettings(), '{"enabled":true}');
  assert.ok(f.calls.includes('slick:rpc:readSettings'));
  assert.equal(bridge.initialSettings, snapshot);
});

test('failed or non-string boot reads allow Slack to load without an enabled-default snapshot', async () => {
  for (const invalid of [null, false, {}, undefined]) {
    const f = fixture(Promise.resolve(invalid));
    f.resolveHtml();
    await f.ready;
    assert.equal(f.exposed()!.claim()!.initialSettings, undefined);
    assert.equal(f.writes.length, 2);
    assert.equal(f.pendingTimers(), 0);
  }
  const settings = deferred<unknown>();
  const f = fixture(settings.promise);
  settings.reject(new Error('Settings unavailable'));
  f.resolveHtml();
  await f.ready;
  assert.equal(f.exposed()!.claim()!.initialSettings, undefined);
  assert.equal(f.pendingTimers(), 0);
});

test('a stalled optional settings read times out from request start and late results stay ignored', async () => {
  const settings = deferred<unknown>();
  const f = fixture(settings.promise);
  // The timeout is already running while the HTML response is still pending.
  f.expireSettingsRead();
  f.resolveHtml();
  await f.ready;
  const bridge = f.exposed()!.claim()!;
  assert.equal(bridge.initialSettings, undefined);
  assert.equal(f.writes.length, 2, 'Slack still loads after the optional read expires');
  settings.resolve('{"plugins":{"Snappy":{"optimizeStateTracking":true}}}');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(bridge.initialSettings, undefined);
  assert.equal(f.pendingTimers(), 0);

  const rejected = deferred<unknown>();
  const failed = fixture(rejected.promise);
  failed.resolveHtml();
  await failed.parsed;
  failed.expireSettingsRead();
  await failed.ready;
  rejected.reject(new Error('Late settings failure'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(failed.exposed()!.claim()!.initialSettings, undefined);
  assert.equal(failed.pendingTimers(), 0);
});

test('safe mode and malformed settings reach the strict boot policy without rewriting preferences', async () => {
  const invalid = '{broken';
  const f = fixture(Promise.resolve(invalid), true);
  f.resolveHtml();
  await f.ready;
  const bridge = f.exposed()!.claim()!;
  assert.equal(bridge.safeMode, true);
  assert.equal(bridge.initialSettings, invalid);
  assert.equal(
    f.calls.some((call) => call.endsWith(':writeSettings')),
    false,
  );
});

test('failed or invalid safe-mode reads suppress boot settings without changing the bridge fallback', async () => {
  for (const invalid of [undefined, null, 'false', 0, {}]) {
    const f = fixture(Promise.resolve('{}'), Promise.resolve(invalid));
    f.resolveHtml();
    await f.ready;
    const bridge = f.exposed()!.claim()!;
    assert.equal(bridge.safeMode, false);
    assert.equal(bridge.initialSettings, undefined);
    assert.equal(f.calls.filter((call) => call === 'slick:get-safe-mode').length, 1);
    assert.equal(f.writes.length, 2);
  }
  const mode = deferred<unknown>();
  const f = fixture(Promise.resolve('{}'), mode.promise);
  mode.reject(new Error('Recovery mode unavailable'));
  f.resolveHtml();
  await f.ready;
  const bridge = f.exposed()!.claim()!;
  assert.equal(bridge.safeMode, false);
  assert.equal(bridge.initialSettings, undefined);
  assert.equal(f.calls.filter((call) => call === 'slick:get-safe-mode').length, 1);
});
