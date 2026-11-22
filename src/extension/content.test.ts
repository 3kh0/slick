import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installRelay } from './content.ts';
import { CHANNEL } from './rpc.ts';
import type { ExtensionBrowser } from './rpc.ts';
import { CSS_KEY, SETTINGS_KEY, THEME_CSS_KEY } from './storage.ts';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function relayTarget(storageState: Record<string, string> = {}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const posts: unknown[] = [];
  const target = {
    location: { origin: 'https://app.slack.com', pathname: '/client/T' },
    sessionStorage: {
      getItem: (key: string) => storageState[key] ?? null,
      setItem: (key: string, value: string) => {
        storageState[key] = value;
      },
      removeItem: (key: string) => {
        delete storageState[key];
      },
    },
    addEventListener: (name: string, cb: (event: unknown) => void) => listeners.set(name, cb),
    postMessage: (m: unknown) => posts.push(m),
  } as unknown as Window;
  Object.defineProperty(target, 'top', { value: target });
  return { target, listeners, posts };
}

test('isolated relay rejects foreign source/origin, malformed messages and runtime failures', async () => {
  const { target, listeners, posts } = relayTarget();
  const calls: unknown[] = [];
  let fail = false;
  const api = {
    runtime: {
      sendMessage: async (m: unknown) => {
        calls.push(m);
        if (fail) throw new Error('private detail');
        return { ok: true, value: '{}' };
      },
    },
    storage: { onChanged: { addListener: () => {} } },
  } as unknown as ExtensionBrowser;
  installRelay(api, target);
  // Normal loads with no prior exemption skip tabMode to avoid waking the service worker.
  assert.equal(calls.length, 0);
  const data = { channel: CHANNEL, kind: 'request', id: 'test-1', method: 'readSettings', args: [] };
  const event = { source: target, origin: target.location.origin, data };
  const receive = listeners.get('message')!;
  receive({ ...event, source: {} });
  receive({ ...event, origin: 'https://evil' });
  receive({ ...event, data: { ...data, method: 'fetch' } });
  receive({ ...event, data: { ...data, kind: 'response' } });
  assert.equal(calls.length, 0);
  receive(event);
  receive(event);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.deepEqual(posts[0], { channel: CHANNEL, kind: 'response', id: 'test-1', response: { ok: true, value: '{}' } });
  fail = true;
  receive({ ...event, data: { ...data, id: 'test-2' } });
  await Promise.resolve();
  assert.deepEqual(posts[1], {
    channel: CHANNEL,
    kind: 'response',
    id: 'test-2',
    response: { ok: false, error: 'Extension disconnected' },
  });
  listeners.get('pagehide')!({});
  receive(event);
  assert.equal(calls.length, 2);
});

test('invalidated Chromium context handles synchronous throws on startup, requests and bfcache restore', async () => {
  const { target, listeners, posts } = relayTarget();
  let calls = 0;
  const api = {
    runtime: {
      sendMessage() {
        calls++;
        throw new Error('Extension context invalidated.');
      },
    },
    storage: { onChanged: { addListener() {} } },
  } as unknown as ExtensionBrowser;
  assert.doesNotThrow(() => installRelay(api, target));
  const data = { channel: CHANNEL, kind: 'request', id: 'stale-context', method: 'readSettings', args: [] };
  assert.doesNotThrow(() => listeners.get('message')!({ source: target, origin: target.location.origin, data }));
  await Promise.resolve();
  assert.deepEqual(posts, [
    {
      channel: CHANNEL,
      kind: 'response',
      id: 'stale-context',
      response: { ok: false, error: 'Extension disconnected' },
    },
  ]);
  assert.doesNotThrow(() => listeners.get('pageshow')!({ persisted: true }));
  await Promise.resolve();
  assert.equal(calls, 3);
  assert.equal(posts.length, 1);
});

test('smart tabMode reports safe/bypass exemptions and clears them once normal resumes', async () => {
  const session: Record<string, string> = { 'slick:firefox:safe-mode': '1' };
  const calls: unknown[] = [];
  const api = {
    runtime: {
      sendMessage: async (m: unknown) => {
        calls.push(m);
        return { ok: true, value: true };
      },
    },
    storage: { onChanged: { addListener() {} } },
  } as unknown as ExtensionBrowser;

  installRelay(api, relayTarget(session).target);
  assert.deepEqual(calls.splice(0), [{ method: 'tabMode', args: ['safe'] }]);
  assert.equal(session['slick:firefox:exempt'], '1');

  delete session['slick:firefox:safe-mode'];
  installRelay(api, relayTarget(session).target);
  await flush();
  assert.deepEqual(calls.splice(0), [{ method: 'tabMode', args: ['normal'] }]);
  assert.equal(session['slick:firefox:exempt'], undefined);

  installRelay(api, relayTarget(session).target);
  await flush();
  assert.equal(calls.length, 0);
});

test('storage.local boot prefetch serves initial reads once and invalidates on writes or changes', async () => {
  const { target, listeners, posts } = relayTarget();
  const calls: unknown[] = [];
  let onChanged!: (changes: Record<string, { newValue?: unknown }>, area: string) => void;
  const api = {
    runtime: {
      sendMessage: async (m: unknown) => {
        calls.push(m);
        return {
          ok: true,
          value: m && (m as { method: string }).method === 'readSettings' ? '{"fresh":1}' : 'fresh css',
        };
      },
    },
    storage: {
      local: {
        get: async () => ({ [SETTINGS_KEY]: '{"prefetched":true}', [CSS_KEY]: 'body{color:red}' }),
      },
      onChanged: { addListener: (cb: typeof onChanged) => (onChanged = cb) },
    },
  } as unknown as ExtensionBrowser;

  installRelay(api, target);
  const send = (id: string, method: string, args: string[] = []) =>
    listeners.get('message')!({
      source: target,
      origin: target.location.origin,
      data: { channel: CHANNEL, kind: 'request', id, method, args },
    });

  send('r-set-1', 'readSettings');
  send('r-css-1', 'readUserCss');
  await flush();
  assert.equal(calls.length, 0);
  assert.deepEqual(posts, [
    { channel: CHANNEL, kind: 'response', id: 'r-set-1', response: { ok: true, value: '{"prefetched":true}' } },
    { channel: CHANNEL, kind: 'response', id: 'r-css-1', response: { ok: true, value: 'body{color:red}' } },
  ]);

  // Second read must go to the background because prefetch is one-shot.
  send('r-set-2', 'readSettings');
  await flush();
  assert.equal(calls.length, 1);

  // storage.onChanged invalidates unconsumed prefetch slots.
  const second = relayTarget();
  const calls2: unknown[] = [];
  let onChanged2!: (changes: Record<string, { newValue?: unknown }>, area: string) => void;
  const api2 = {
    runtime: {
      sendMessage: async (m: unknown) => {
        calls2.push(m);
        return { ok: true, value: '{"updated":true}' };
      },
    },
    storage: {
      local: { get: async () => ({ [SETTINGS_KEY]: '{"stale":true}' }) },
      onChanged: { addListener: (cb: typeof onChanged2) => (onChanged2 = cb) },
    },
  } as unknown as ExtensionBrowser;
  installRelay(api2, second.target);
  onChanged2({ [SETTINGS_KEY]: { newValue: '{"updated":true}' } }, 'local');
  second.listeners.get('message')!({
    source: second.target,
    origin: second.target.location.origin,
    data: { channel: CHANNEL, kind: 'request', id: 'after-change', method: 'readSettings', args: [] },
  });
  await flush();
  assert.deepEqual(calls2, [{ method: 'readSettings', args: [] }]);
});

test('pre-paint CSS and mode-gated theme styles inject before bootstrap', async () => {
  const styles = new Map<string, { dataset: Record<string, string>; textContent: string; remove(): void }>();
  const appended: unknown[] = [];
  const bodyClasses = new Set<string>();
  const bodyObservers: (() => void)[] = [];
  let disconnected = 0;

  const doc = {
    head: { appendChild: (el: unknown) => appended.push(el) },
    body: { classList: { contains: (cls: string) => bodyClasses.has(cls) } },
    createElement: () => {
      const el = { dataset: {} as Record<string, string>, textContent: '', remove: () => {} };
      return {
        get dataset() {
          return el.dataset;
        },
        get textContent() {
          return el.textContent;
        },
        set textContent(v: string) {
          el.textContent = v;
          if (el.dataset.slickStyle) styles.set(el.dataset.slickStyle, el);
        },
      };
    },
    querySelector: (selector: string) => {
      const match = /^style\[data-slick-style="([^"]+)"\]$/.exec(selector);
      return match ? (styles.get(match[1]) ?? null) : null;
    },
  };

  class FakeObserver {
    cb: () => void;
    constructor(cb: () => void) {
      this.cb = cb;
      bodyObservers.push(cb);
    }
    observe() {}
    disconnect() {
      disconnected++;
    }
  }

  const { target } = relayTarget();
  Object.assign(target, { document: doc, MutationObserver: FakeObserver });
  const api = {
    runtime: { sendMessage: async () => ({ ok: true, value: true }) },
    storage: {
      local: {
        get: async () => ({
          [CSS_KEY]: '.custom{color:red}',
          [THEME_CSS_KEY]: { css: ':root{--bg:#000}', mode: 'dark' },
        }),
      },
      onChanged: { addListener() {} },
    },
  } as unknown as ExtensionBrowser;

  installRelay(api, target);
  await flush();
  assert.equal(styles.get('user')?.textContent, '.custom{color:red}');
  assert.equal(styles.get('theme'), undefined);
  assert.equal(appended.length, 1);

  bodyClasses.add('sk-client-theme--dark');
  for (const cb of bodyObservers) cb();
  assert.equal(styles.get('theme')?.textContent, ':root{--bg:#000}');
  assert.equal(disconnected, 1);
});

test('MessageChannel startup port is one-shot, handles requests/changes, and closes on unload', async () => {
  const { target, listeners, posts } = relayTarget();
  const calls: unknown[] = [];
  let onChanged!: (changes: Record<string, { newValue?: unknown }>, area: string) => void;
  const api = {
    runtime: {
      sendMessage: async (m: unknown) => {
        calls.push(m);
        return { ok: true, value: '{}' };
      },
    },
    storage: { onChanged: { addListener: (cb: typeof onChanged) => (onChanged = cb) } },
  } as unknown as ExtensionBrowser;

  installRelay(api, target);

  function fakePort() {
    const sent: unknown[] = [];
    const handlers: ((ev: { data: unknown }) => void)[] = [];
    let closed = false;
    let started = false;
    return {
      sent,
      get closed() {
        return closed;
      },
      get started() {
        return started;
      },
      addEventListener: (_type: string, cb: (ev: { data: unknown }) => void) => handlers.push(cb),
      start: () => {
        started = true;
      },
      dispatch: (data: unknown) => {
        if (!started) throw new Error('port not started');
        for (const cb of handlers) cb({ data });
      },
      postMessage: (m: unknown) => sent.push(m),
      close: () => {
        closed = true;
      },
    };
  }
  const port1 = fakePort();
  const port2 = fakePort();
  const receive = listeners.get('message')!;

  receive({ source: target, origin: target.location.origin, data: { channel: CHANNEL, kind: 'port' }, ports: [port1] });
  assert.equal(port1.started, true);
  // Second port attempt must be ignored (one-shot).
  receive({ source: target, origin: target.location.origin, data: { channel: CHANNEL, kind: 'port' }, ports: [port2] });

  // Window postMessage requests are ignored once port is active.
  receive({
    source: target,
    origin: target.location.origin,
    data: { channel: CHANNEL, kind: 'request', id: 'win-1', method: 'readSettings', args: [] },
  });
  assert.equal(calls.length, 0);

  port1.dispatch({ channel: CHANNEL, kind: 'request', id: 'port-1', method: 'readSettings', args: [] });
  await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(port1.sent, [
    { channel: CHANNEL, kind: 'response', id: 'port-1', response: { ok: true, value: '{}' } },
  ]);

  onChanged({ [SETTINGS_KEY]: { newValue: '{"changed":true}' } }, 'local');
  assert.deepEqual(port1.sent[1], { channel: CHANNEL, kind: 'change', event: 'settings', value: '{"changed":true}' });
  assert.equal(port2.sent.length, 0);
  assert.equal(posts.length, 0);

  listeners.get('pagehide')!({ persisted: false });
  assert.equal(port1.closed, true);
});
