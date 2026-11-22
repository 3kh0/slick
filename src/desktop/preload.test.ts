import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import type { SlickBridge } from '../app/bridge.ts';

// Exercise the real preload's sync boot ordering without launching Electron.
const preload = transformSync(readFileSync(new URL('./preload.ts', import.meta.url), 'utf8'), {
  loader: 'ts',
  format: 'cjs',
  target: 'es2022',
}).code;

type FixtureOptions = {
  hostname?: string;
  pathname?: string;
  boot?: unknown;
  bootThrows?: boolean;
  handoff?: unknown;
  recoveryFlag?: string;
  executeRejects?: boolean;
  earlyCode?: string;
};

function fixture(opts: FixtureOptions = {}) {
  const executed: string[] = [];
  const lifecycle: string[] = [];
  const writes: string[] = [];
  const rpcCalls: Array<[string, string, unknown[]]> = [];
  const local = new Map<string, string>();
  const recovery = new Map<string, string>();
  if (opts.recoveryFlag !== undefined) recovery.set('slick:preload-recovery', opts.recoveryFlag);

  let signInHooked = 0;
  let exposed: { claim(): SlickBridge | null } | undefined;
  let readySettled!: Promise<void>;
  let resolveReady!: () => void;
  let rejectReady!: (err: unknown) => void;
  readySettled = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  const ipc = {
    invoke(channel: string, method?: string, args: unknown[] = []) {
      rpcCalls.push([channel, method ?? '', args]);
      return Promise.resolve('{}');
    },
    sendSync(channel: string) {
      lifecycle.push(`sendSync:${channel}`);
      if (channel === 'slick:account-handoff') return opts.handoff ?? null;
      if (channel === 'slick:get-boot-sync') {
        if (opts.bootThrows) throw new Error('boot sync unavailable');
        return opts.boot === undefined
          ? {
              paths: { settings: '/tmp/s' },
              safeMode: false,
              initialSettings: '{}',
              appUrl: 'slick://app/slick.js?v=1',
            }
          : opts.boot;
      }
      throw new Error(`Unexpected sendSync: ${channel}`);
    },
    send(channel: string, event?: string) {
      lifecycle.push(event ? `${channel}:${event}` : channel);
      if (event === 'preload.ready') resolveReady();
      if (event === 'preload.failed') rejectReady(new Error('Preload failed'));
    },
    on() {},
    removeListener() {},
  };

  const evalQueue: Promise<void>[] = [];

  runInNewContext(preload, {
    require(id: string) {
      if (id === 'slick:early') return { __esModule: true, default: opts.earlyCode ?? '/*early*/' };
      if (id === 'electron') {
        return {
          ipcRenderer: ipc,
          contextBridge: {
            exposeInMainWorld(name: string, value: typeof exposed) {
              lifecycle.push(`expose:${name}`);
              if (name === 'SlickBridge') exposed = value;
            },
          },
          webFrame: {
            executeJavaScript(code: string) {
              lifecycle.push('webFrame.executeJavaScript');
              executed.push(code);
              const p = opts.executeRejects ? Promise.reject(new Error('exec failed')) : Promise.resolve(undefined);
              evalQueue.push(p.catch(() => {}));
              return p;
            },
          },
        };
      }
      if (id.endsWith('/accounts.ts')) {
        return {
          applyPendingAccountSwitch() {
            lifecycle.push('applyPendingAccountSwitch');
          },
          PENDING_ACCOUNT_SWITCH_KEY: 'pending',
        };
      }
      if (id.endsWith('/signInButton.ts')) {
        return {
          installCookieSignInButton() {
            signInHooked++;
          },
        };
      }
      throw new Error(`Unexpected preload import: ${id}`);
    },
    console,
    URL,
    localStorage: {
      setItem: (k: string, v: string) => local.set(k, v),
      getItem: (k: string) => local.get(k) ?? null,
    },
    location: {
      hostname: opts.hostname ?? 'app.slack.com',
      pathname: opts.pathname ?? '/client/T/C',
      href: 'https://app.slack.com/client/T/C',
    },
    sessionStorage: {
      getItem: (key: string) => recovery.get(key) ?? null,
      removeItem: (key: string) => recovery.delete(key),
      setItem: (key: string, value: string) => recovery.set(key, value),
    },
    document: {
      open() {},
      close() {},
      write(v: string) {
        writes.push(v);
      },
    },
  });

  return {
    executed,
    lifecycle,
    writes,
    rpcCalls,
    recovery,
    ready: readySettled,
    signInHooked: () => signInHooked,
    exposed: () => exposed,
    flush: () => Promise.all(evalQueue),
  };
}

test('exposes one-shot bridge synchronously before running early code and injecting runtime script', async () => {
  const f = fixture({ earlyCode: 'window.__early = 1;' });
  await f.ready;

  assert.equal(f.writes.length, 0, 'document must not be rebuilt');
  const exposeIdx = f.lifecycle.indexOf('expose:SlickBridge');
  const execIdx = f.lifecycle.indexOf('webFrame.executeJavaScript');
  const readyIdx = f.lifecycle.indexOf('slick:account-diagnostic:preload.ready');
  assert.ok(exposeIdx > -1 && execIdx > exposeIdx && readyIdx > execIdx);

  assert.equal(f.executed.length, 1);
  assert.match(f.executed[0], /window\.__early = 1;/);
  assert.match(f.executed[0], /slick:\/\/app\/slick\.js\?v=1/);
  assert.doesNotMatch(f.executed[0], /setAttribute\(['"]onerror['"]/);

  const bridge = f.exposed()!.claim()!;
  assert.equal(bridge.loader, 'electron');
  assert.equal(bridge.safeMode, false);
  assert.equal(bridge.initialSettings, '{}');
  assert.equal(f.exposed()!.claim(), null);

  await bridge.evaluateUserPlugin!('(globalThis.__slickPlugins ??= []).push(() => class {})');
  assert.equal(f.executed.length, 2);
  assert.match(f.executed[1], /__slickPlugins/);
});

test('recovery flag clears itself and leaves Slack completely unmodified', async () => {
  const f = fixture({ recoveryFlag: '1' });
  await f.flush();
  assert.equal(f.recovery.has('slick:preload-recovery'), false);
  assert.equal(f.exposed(), undefined);
  assert.equal(f.executed.length, 0);
  assert.equal(f.lifecycle.includes('sendSync:slick:get-boot-sync'), false);
});

test('failed or invalid boot snapshots stay fail-closed without suppressing defaults silently', async () => {
  for (const invalid of [null, undefined, 'false', {}, 0]) {
    const f = fixture({
      boot: { paths: {}, safeMode: invalid, initialSettings: '{"enabled":true}', appUrl: 'slick://app/slick.js' },
    });
    await f.ready;
    const bridge = f.exposed()!.claim()!;
    assert.equal(bridge.safeMode, false);
    assert.equal(bridge.initialSettings, undefined);
  }

  for (const invalidSettings of [null, false, {}, undefined]) {
    const f = fixture({
      boot: { paths: {}, safeMode: false, initialSettings: invalidSettings, appUrl: '' },
    });
    await f.ready;
    const bridge = f.exposed()!.claim()!;
    assert.equal(bridge.initialSettings, undefined);
    assert.match(f.executed[0], /slick:\/\/app\/slick\.js/);
  }

  const throwsBoot = fixture({ bootThrows: true });
  await throwsBoot.ready;
  const throwsBridge = throwsBoot.exposed()!.claim()!;
  assert.equal(throwsBridge.safeMode, false);
  assert.equal(throwsBridge.initialSettings, undefined);

  const safeModeMalformed = fixture({
    boot: { paths: {}, safeMode: true, initialSettings: '{broken', appUrl: 'slick://app/slick.js' },
  });
  await safeModeMalformed.ready;
  const safeBridge = safeModeMalformed.exposed()!.claim()!;
  assert.equal(safeBridge.safeMode, true);
  assert.equal(safeBridge.initialSettings, '{broken');
});

test('early execution failure reports preload.failed without blanking or reloading the page', async () => {
  const f = fixture({ executeRejects: true });
  await assert.rejects(f.ready, /Preload failed/);
  assert.equal(f.writes.length, 0);
});

test('non-client slack.com pages install the cookie sign-in button only', () => {
  const f = fixture({ hostname: 'myteam.slack.com', pathname: '/signin' });
  assert.equal(f.signInHooked(), 1);
  assert.equal(f.exposed(), undefined);
  assert.equal(f.executed.length, 0);
});
