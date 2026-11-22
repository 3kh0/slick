import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import type { SlickBridge } from '../app/bridge.ts';

const preload = transformSync(readFileSync(new URL('./preload.ts', import.meta.url), 'utf8'), {
  loader: 'ts',
  format: 'cjs',
  target: 'es2022',
}).code;

type Opts = {
  hostname?: string;
  pathname?: string;
  boot?: unknown;
  bootThrows?: boolean;
  recovery?: string;
  handoff?: unknown;
  executeRejects?: boolean;
  earlyCode?: string;
  deferredDom?: boolean;
};

type ScriptEl = {
  tagName: string;
  id: string;
  async: boolean;
  src: string;
  errorListeners: Array<() => void>;
  addEventListener: (t: string, f: () => void) => void;
};

function fixture(o: Opts = {}) {
  const executed: string[] = [];
  const lifecycle: string[] = [];
  const writes: string[] = [];
  const stored = new Map<string, string>();
  const scripts: ScriptEl[] = [];
  const rec = new Map(o.recovery === undefined ? [] : [['slick:preload-recovery', o.recovery]]);
  let signInHooked = 0;
  let exposed: { claim(): SlickBridge | null } | undefined;
  let disconnected = false;
  let trigger: (() => void) | undefined;
  let head = o.deferredDom ? null : { appendChild: (el: ScriptEl) => void scripts.push(el) };
  let done!: () => void;
  let fail!: (e: unknown) => void;
  const ready = new Promise<void>((res, rej) => ((done = res), (fail = rej)));
  const evalQueue: Promise<void>[] = [];

  const ipc = {
    invoke: () => Promise.resolve('{}'),
    sendSync(ch: string) {
      lifecycle.push(`sendSync:${ch}`);
      if (ch === 'slick:account-handoff') return o.handoff ?? null;
      if (ch === 'slick:get-boot-sync') {
        if (o.bootThrows) throw new Error('boot sync unavailable');
        return o.boot === undefined
          ? {
              paths: { settings: '/tmp/s' },
              safeMode: false,
              initialSettings: '{}',
              appUrl: 'slick://app/slick.js?v=1',
            }
          : o.boot;
      }
      throw new Error(`Unexpected sendSync: ${ch}`);
    },
    send(ch: string, ev?: string) {
      lifecycle.push(ev ? `${ch}:${ev}` : ch);
      if (ev === 'preload.ready') done();
      if (ev === 'preload.failed') fail(new Error('Preload failed'));
    },
    on() {},
    removeListener() {},
  };

  runInNewContext(preload, {
    require(id: string) {
      if (id === 'slick:early') return { __esModule: true, default: o.earlyCode ?? '/*early*/' };
      if (id === 'electron') {
        return {
          ipcRenderer: ipc,
          contextBridge: {
            exposeInMainWorld: (n: string, v: typeof exposed) => (
              lifecycle.push(`expose:${n}`),
              n === 'SlickBridge' && (exposed = v)
            ),
          },
          webFrame: {
            executeJavaScript(code: string) {
              lifecycle.push('webFrame.executeJavaScript');
              executed.push(code);
              const p = o.executeRejects ? Promise.reject(new Error('exec failed')) : Promise.resolve(undefined);
              evalQueue.push(p.catch(() => {}));
              return p;
            },
          },
        };
      }
      if (id.endsWith('/accounts.ts')) return { applyPendingAccountSwitch() {}, PENDING_ACCOUNT_SWITCH_KEY: 'pending' };
      if (id.endsWith('/signInButton.ts')) return { installCookieSignInButton: () => void signInHooked++ };
      throw new Error(`Unexpected preload import: ${id}`);
    },
    console,
    URL,
    localStorage: { setItem: (k: string, v: string) => void stored.set(k, v), getItem: () => null },
    location: {
      hostname: o.hostname ?? 'app.slack.com',
      pathname: o.pathname ?? '/client/T/C',
      href: 'https://app.slack.com/client/T/C',
    },
    sessionStorage: {
      getItem: (k: string) => rec.get(k) ?? null,
      removeItem: (k: string) => rec.delete(k),
      setItem: (k: string, v: string) => rec.set(k, v),
    },
    MutationObserver: class {
      constructor(cb: () => void) {
        trigger = cb;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
    document: {
      get head() {
        return head;
      },
      documentElement: null,
      createElement(tagName: string): ScriptEl {
        const errorListeners: Array<() => void> = [];
        return {
          tagName,
          id: '',
          async: false,
          src: '',
          errorListeners,
          addEventListener: (t, f) => t === 'error' && errorListeners.push(f),
        };
      },
      open() {},
      close() {},
      write: (v: string) => void writes.push(v),
    },
  });

  return {
    executed,
    lifecycle,
    writes,
    stored,
    scripts,
    rec,
    ready,
    signInHooked: () => signInHooked,
    exposed: () => exposed,
    disconnected: () => disconnected,
    mountHead() {
      head = { appendChild: (el: ScriptEl) => void scripts.push(el) };
      trigger?.();
    },
    flush: () => Promise.all(evalQueue),
  };
}

test('exposes one-shot bridge synchronously before running early code and injecting runtime script', async () => {
  const f = fixture({ earlyCode: 'window.__early = 1;' });
  await f.ready;
  assert.equal(f.writes.length, 0);
  const [e, x, r] = ['expose:SlickBridge', 'webFrame.executeJavaScript', 'slick:account-diagnostic:preload.ready'].map(
    (s) => f.lifecycle.indexOf(s),
  );
  assert.ok(e > -1 && x > e && r > x);
  assert.deepEqual(f.executed, ['window.__early = 1;']);
  assert.equal(f.scripts.length, 1);
  assert.deepEqual(
    { id: f.scripts[0].id, async: f.scripts[0].async, src: f.scripts[0].src, errs: f.scripts[0].errorListeners.length },
    { id: 'slick-app', async: true, src: 'slick://app/slick.js?v=1', errs: 1 },
  );

  const b = f.exposed()!.claim()!;
  assert.equal(b.loader, 'electron');
  assert.equal(b.safeMode, false);
  assert.equal(b.initialSettings, '{}');
  assert.equal(f.exposed()!.claim(), null);

  await b.evaluateUserPlugin!('(globalThis.__slickPlugins ??= []).push(() => class {})');
  assert.equal(f.executed.length, 2);
  assert.match(f.executed[1], /__slickPlugins/);
});

test('recovery flag clears itself and leaves Slack completely unmodified', async () => {
  const f = fixture({ recovery: '1' });
  await f.flush();
  assert.equal(f.rec.has('slick:preload-recovery'), false);
  assert.equal(f.exposed(), undefined);
  assert.equal(f.executed.length, 0);
  assert.equal(f.scripts.length, 0);
  assert.equal(f.lifecycle.includes('sendSync:slick:get-boot-sync'), false);
});

test('a pending account handoff is applied even on a recovery pass', async () => {
  const f = fixture({ recovery: '1', handoff: { team: 'T1' } });
  await f.flush();
  assert.equal(f.stored.get('pending'), JSON.stringify({ team: 'T1' }));
  assert.equal(f.lifecycle.includes('slick:account-diagnostic:preload.handoff-applied'), true);
  assert.equal(f.exposed(), undefined);
});

test('failed or invalid boot snapshots stay fail-closed without suppressing defaults silently', async () => {
  for (const invalid of [null, undefined, 'false', {}, 0]) {
    const f = fixture({
      boot: { paths: {}, safeMode: invalid, initialSettings: '{"enabled":true}', appUrl: 'slick://app/slick.js' },
    });
    await f.ready;
    const b = f.exposed()!.claim()!;
    assert.equal(b.safeMode, false);
    assert.equal(b.initialSettings, undefined);
  }
  for (const invalid of [null, false, {}, undefined]) {
    const f = fixture({ boot: { paths: {}, safeMode: false, initialSettings: invalid, appUrl: '' } });
    await f.ready;
    assert.equal(f.exposed()!.claim()!.initialSettings, undefined);
    assert.match(f.scripts[0]?.src ?? '', /^slick:\/\/app\/slick\.js\?v=\d+$/);
  }
  for (const badUrl of ['', 'https://evil.example/x.js', 'javascript:alert(1)']) {
    const f = fixture({ boot: { paths: {}, safeMode: false, initialSettings: '{}', appUrl: badUrl } });
    await f.ready;
    assert.match(f.scripts[0]?.src ?? '', /^slick:\/\/app\/slick\.js\?v=\d+$/);
  }
  const throwsBoot = fixture({ bootThrows: true });
  await throwsBoot.ready;
  const tb = throwsBoot.exposed()!.claim()!;
  assert.equal(tb.safeMode, false);
  assert.equal(tb.initialSettings, undefined);

  const safeMalformed = fixture({
    boot: { paths: {}, safeMode: true, initialSettings: '{broken', appUrl: 'slick://app/slick.js' },
  });
  await safeMalformed.ready;
  const sb = safeMalformed.exposed()!.claim()!;
  assert.equal(sb.safeMode, true);
  assert.equal(sb.initialSettings, '{broken');
});

test('deferred DOM waits for MutationObserver before attaching runtime script', async () => {
  const f = fixture({ deferredDom: true });
  await f.ready;
  assert.equal(f.scripts.length, 0);
  assert.equal(f.disconnected(), false);
  f.mountHead();
  assert.equal(f.scripts[0]?.src, 'slick://app/slick.js?v=1');
  assert.equal(f.disconnected(), true);
});

test('runtime script load error deletes earlyCore and keeps SlickBridge unclaimable', async () => {
  const f = fixture();
  await f.ready;
  f.scripts[0].errorListeners[0]();
  await f.flush();
  assert.equal(f.exposed()!.claim(), null);
  assert.equal(f.executed[1], "delete globalThis[Symbol.for('slick.earlyCore')]");
});

test('early execution failure reports preload.failed without blanking or reloading the page', async () => {
  const f = fixture({ executeRejects: true });
  await assert.rejects(f.ready, /Preload failed/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.scripts.length, 0);
  assert.equal(f.exposed()!.claim(), null);
});

test('non-client slack.com pages install the cookie sign-in button only', () => {
  const f = fixture({ hostname: 'myteam.slack.com', pathname: '/signin' });
  assert.equal(f.signInHooked(), 1);
  assert.equal(f.exposed(), undefined);
  assert.equal(f.executed.length, 0);
});
