// Real Firefox smoke test. Requires geckodriver on PATH; never uses a user's profile.
// node scripts/firefox-smoke.ts [--firefox /path/to/firefox]
// Optional authenticated check: --profile /source/profile --slack-url https://app.slack.com/client/...
// Only Slack cookies/site storage are copied to an owner-only temporary profile, deleted on exit.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, cp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { EXTENSION_PLUGINS } from '../src/extension/plugins.ts';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
};
const liveUrl = arg('--slack-url');
if (liveUrl) {
  const url = new URL(liveUrl);
  assert.equal(url.origin, 'https://app.slack.com');
  assert.match(url.pathname, /^\/client\//);
}
const sourceProfile = arg('--profile');
if (sourceProfile && !liveUrl) throw new Error('--profile requires --slack-url');
const profile = await mkdtemp(path.join(tmpdir(), 'slick-firefox-'));
await chmod(profile, 0o700);
const endpoint = process.env.GECKODRIVER_URL ?? 'http://127.0.0.1:4447';
const driver = process.env.GECKODRIVER_URL
  ? null
  : spawn('geckodriver', ['--port', '4447', '--log', 'fatal', '--allow-system-access'], { stdio: 'ignore' });
let driverError: Error | undefined;
driver?.on('error', (error) => {
  driverError = error;
});
let session = '';
let socket: WebSocket | undefined;
const outstanding = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
let seq = 0;
const slickLog: string[] = [];
const embedEvents: { url: string; event: string }[] = [];
async function http(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(endpoint + route, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as any;
  if (!response.ok)
    throw new Error(
      `WebDriver ${json.value?.error ?? response.status} (${method} ${route.replace(/^\/session\/[^/]+/, '')})`,
    );
  return json.value;
}
const command = (route: string, body?: unknown, method?: string) => http(`/session/${session}${route}`, body, method);
const execute = (script: string, scriptArgs: unknown[] = []) => command('/execute/sync', { script, args: scriptArgs });
const asyncExecute = (script: string, scriptArgs: unknown[] = []) =>
  command('/execute/async', { script, args: scriptArgs });
const bidi = (method: string, params: unknown) =>
  new Promise<any>((resolve, reject) => {
    const id = ++seq;
    outstanding.set(id, { resolve, reject });
    socket!.send(JSON.stringify({ id, method, params }));
  });
async function until<T>(
  operation: () => Promise<T>,
  ready: (v: T) => boolean,
  label: string,
  attempts = 60,
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    const value = await operation();
    if (ready(value)) return value;
    await delay(500);
  }
  throw new Error(`${label} timed out`);
}
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Slick fixture</title>
<script nonce="slick-fixture">
window.__fixture = { early: typeof Object.getOwnPropertyDescriptor(window, 'webpackChunkwebapp')?.get === 'function' };
try { eval('1'); window.__fixture.evalBlocked = false; } catch { window.__fixture.evalBlocked = true; }
window.webpackChunkwebapp = [];
window.webpackChunkwebapp.push([[1], {fixture: function(module) { module.exports = { slickFixture: true }; }}, function() {}]);
window.webpackChunkwebapp[0][1].fixture({exports: {}}, {}, function(){});
</script></head><body><h1>Local Slick test fixture</h1></body></html>`;
try {
  if (sourceProfile) {
    // A running Firefox holds cookies.sqlite with an exclusive lock, so snapshot
    // the database + WAL first and filter the copy; the source is never opened.
    const cookies = path.join(profile, 'cookies.sqlite');
    for (const suffix of ['', '-wal']) {
      await cp(path.join(sourceProfile, `cookies.sqlite${suffix}`), cookies + suffix).catch((error) => {
        if (suffix === '' || error.code !== 'ENOENT') throw error;
      });
    }
    execFileSync(
      'python3',
      [
        '-c',
        `import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
db.execute("DELETE FROM moz_cookies WHERE NOT (host = 'slack.com' OR host = '.slack.com' OR host LIKE '%.slack.com')")
db.commit(); db.execute('PRAGMA wal_checkpoint(TRUNCATE)'); db.execute('VACUUM'); db.close()
`,
        cookies,
      ],
      { stdio: 'pipe', timeout: 30000 },
    );
    const root = path.join(sourceProfile, 'storage/default');
    for (const name of await readdir(root)) {
      if (!/^https\+\+\+([a-z0-9-]+\.)*slack\.com(?:\^|$)/.test(name)) continue;
      const dest = path.join(profile, 'storage/default', name);
      await mkdir(path.dirname(dest), { recursive: true });
      await cp(path.join(root, name), dest, { recursive: true });
    }
    console.log('Copied Slack-only session data into disposable profile.');
  }
  for (let i = 0; i < 40; i++) {
    if (driverError) throw driverError;
    try {
      await http('/status');
      break;
    } catch {
      if (i === 39) throw new Error('geckodriver not ready');
    }
    await delay(250);
  }
  const created = await http('/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        webSocketUrl: true,
        // Slack keeps loading after the client is interactive.
        pageLoadStrategy: 'eager',
        'moz:firefoxOptions': {
          ...(arg('--firefox') ? { binary: arg('--firefox') } : {}),
          args: ['-headless', '-profile', profile],
          prefs: {
            'browser.shell.checkDefaultBrowser': false,
            'browser.startup.page': 0,
            'datareporting.healthreport.uploadEnabled': false,
            'toolkit.telemetry.enabled': false,
            'media.navigator.streams.fake': true,
            'media.navigator.permission.disabled': true,
          },
        },
      },
    },
  });
  session = created.sessionId;
  console.log(`Firefox ${created.capabilities.browserVersion}`);
  await command('/timeouts', { script: 15000, pageLoad: 90000 });
  await command('/moz/addon/install', { path: path.resolve('dist/extension/slick-firefox.xpi'), temporary: true });
  socket = new WebSocket(created.capabilities.webSocketUrl);
  await new Promise<void>((resolve, reject) => {
    socket!.addEventListener('open', () => resolve(), { once: true });
    socket!.addEventListener('error', () => reject(new Error('BiDi connection failed')), { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const pending = outstanding.get(message.id);
      outstanding.delete(message.id);
      if (message.type === 'error') pending?.reject(new Error(`BiDi: ${message.error}`));
      else pending?.resolve(message.result);
    } else if (
      ['network.beforeRequestSent', 'network.fetchError', 'network.responseCompleted'].includes(message.method) &&
      String(message.params?.request?.url ?? '').includes('spotify.com')
    ) {
      embedEvents.push({
        url: message.params.request.url,
        event: `${message.method} ${message.params.errorText ?? ''}`.trim(),
      });
      if (message.method === 'network.beforeRequestSent' && message.params.isBlocked) return;
    } else if (message.method === 'log.entryAdded') {
      const text = String(message.params.text ?? '');
      // Slick's own lines only: Slack's console may contain workspace data.
      if (text.startsWith('[slick')) slickLog.push(`${message.params.level}: ${text.slice(0, 300)}`);
    } else if (message.method === 'network.beforeRequestSent' && message.params.isBlocked) {
      void bidi('network.provideResponse', {
        request: message.params.request.request,
        statusCode: 200,
        headers: [
          { name: 'Content-Type', value: { type: 'string', value: 'text/html; charset=utf-8' } },
          {
            name: 'Content-Security-Policy',
            value: {
              type: 'string',
              value:
                "default-src 'none'; script-src 'nonce-slick-fixture'; style-src 'unsafe-inline'; frame-src https://open.spotify.com; connect-src https://slackb.com",
            },
          },
          { name: 'Cache-Control', value: { type: 'string', value: 'no-store' } },
        ],
        body: { type: 'string', value: fixture },
      }).catch((error) => console.error(error.message));
    }
  });
  await bidi('session.subscribe', {
    events: ['network.beforeRequestSent', 'network.fetchError', 'network.responseCompleted', 'log.entryAdded'],
  });
  const intercept = await bidi('network.addIntercept', {
    phases: ['beforeRequestSent'],
    urlPatterns: [{ type: 'string', pattern: 'https://app.slack.com/client/slick-fixture' }],
  });
  await command('/url', { url: 'https://app.slack.com/client/slick-fixture' });
  const observed = await execute(
    'return { ...window.__fixture, captured: !!window.getExport?.(x => x.slickFixture) };',
  );
  assert.deepEqual(observed, { early: true, evalBlocked: true, captured: true });
  console.log('PASS: MAIN document_start hooks run before page scripts; CSP blocks eval; module capture works.');
  const rpc = (method: string, rpcArgs: string[] = []) =>
    asyncExecute(
      `
    const done = arguments[arguments.length - 1];
    const id = 'smoke-' + Math.random().toString(36).slice(2);
    const handler = event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'slick:firefox:v1' || event.data?.id !== id || event.data?.kind !== 'response') return;
      window.removeEventListener('message', handler); done(event.data.response);
    };
    window.addEventListener('message', handler);
    window.postMessage({channel: 'slick:firefox:v1', kind: 'request', id, method: arguments[0], args: arguments[1]}, location.origin);
  `,
      [method, rpcArgs],
    );
  const config = await rpc('readSettings');
  assert.equal(config.ok, true);
  assert.equal(JSON.parse(config.value).plugins.HumanCount.enabled, false);
  assert.equal(
    (
      await rpc('compareAndSwapSettings', [
        config.value,
        JSON.stringify({
          theme: 'catppuccin-mocha',
          plugins: Object.fromEntries(EXTENSION_PLUGINS.map((id) => [id, { enabled: true }])),
        }),
      ])
    ).value,
    true,
  );
  assert.equal((await rpc('writeUserCss', [':root { --slick-firefox-smoke: 1; }'])).value, true);
  console.log('PASS: isolated/background bridge and settings/CSS persistence.');
  const blobs = await asyncExecute(
    `const done = arguments[arguments.length - 1];
    const call = (method, args) => new Promise((resolve) => {
      const id = 'smoke-' + Math.random().toString(36).slice(2);
      const handler = (event) => {
        if (event.source !== window || event.data?.channel !== 'slick:firefox:v1' || event.data?.id !== id || event.data?.kind !== 'response') return;
        window.removeEventListener('message', handler); resolve(event.data.response);
      };
      window.addEventListener('message', handler);
      window.postMessage({ channel: 'slick:firefox:v1', kind: 'request', id, method, args }, location.origin);
    });
    (async () => {
      const ns = 'plugin:MessageLogger';
      await call('blob.clear', [ns]);
      const writes = [];
      for (let i = 0; i < 600; i++) writes.push([ns, 'entry:' + String(i).padStart(4, '0'), '{"n":' + i + '}']);
      for (let i = 0; i < 4; i++) writes.push([ns, 'entry:big' + i, 'x'.repeat(100000)]);
      let written = true;
      // The relay drops requests past MAX_PENDING (64) in flight.
      for (let i = 0; i < writes.length; i += 50)
        for (const r of await Promise.all(writes.slice(i, i + 50).map((args) => call('blob.write', args))))
          written &&= r.ok && r.value === true;
      const pages = [];
      for (let cursor = '';;) {
        const response = await call('blob.readAll', [ns, 'entry:', cursor]);
        if (!response.ok) return done({ written, pages, error: response.error });
        const page = response.value;
        const keys = Object.keys(page);
        if (!keys.length) break;
        pages.push(keys.length);
        cursor = keys.reduce((a, b) => (b > a ? b : a));
      }
      const listed = (await call('blob.list', [ns, ''])).value.length;
      // Oversized requests never reach the background (the relay drops them), so
      // probe the small tier's 512 KB total instead: the ninth 64000-char value is refused.
      await call('blob.clear', ['plugin:Censorship']);
      const small = [];
      for (let i = 0; i < 9; i++) small.push((await call('blob.write', ['plugin:Censorship', 'k' + i, 'x'.repeat(64000)])).ok);
      await call('blob.clear', ['plugin:Censorship']);
      await call('blob.clear', [ns]);
      done({ written, pages, listed, smallRefused: small.slice(0, 8).every(Boolean) && !small[8] });
    })();`,
  );
  assert.equal(blobs.written, true);
  assert.equal(
    blobs.pages.reduce((a: number, b: number) => a + b, 0),
    604,
  );
  assert.ok(blobs.pages.length > 1);
  assert.equal(blobs.listed, 512);
  assert.equal(blobs.smallRefused, true);
  console.log(`PASS: IndexedDB blob store pages ${blobs.pages.join('+')} entries; small quota still enforced.`);
  const slackHandle = await command('/window');
  // Content-context WebDriver and BiDi both refuse moz-extension:// navigation,
  // so open the tab from browser chrome (geckodriver --allow-system-access).
  // A load issued while the extension process is still spinning up can leave
  // the tab on about:blank, so keep reissuing it until the URL sticks.
  await command('/moz/context', { context: 'chrome' });
  const optionsUrl: string = await execute(
    `const url = WebExtensionPolicy.getByID('slick@3kh0.net').getURL('options.html');
    window.__slickOptionsTab = gBrowser.addTab('about:blank', {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    gBrowser.selectedTab = window.__slickOptionsTab;
    return url;`,
  );
  await until(
    () =>
      execute(
        `const browser = window.__slickOptionsTab.linkedBrowser;
        if (browser.currentURI.spec === arguments[0]) return true;
        browser.fixupAndLoadURIString(arguments[0], {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
        return false;`,
        [optionsUrl],
      ),
    Boolean,
    'options tab',
    20,
  );
  await command('/moz/context', { context: 'content' });
  for (const handle of (await command('/window/handles')) as string[]) {
    await command('/window', { handle });
    if ((await command('/url')) === optionsUrl) break;
  }
  const probe = () =>
    execute(
      'return { url: location.href, ready: document.readyState, disabled: document.querySelector("#settings")?.disabled, error: document.querySelector("#error")?.textContent, browser: typeof browser }',
    );
  await until(probe, (v: any) => v.disabled === false, 'options load', 20).catch(async (error) => {
    console.error('options state:', JSON.stringify(await probe()));
    throw error;
  });
  assert.equal(await execute('return document.querySelector("#theme").value'), 'catppuccin-mocha');
  assert.equal(await execute('return document.documentElement.dataset.theme'), 'catppuccin-mocha');
  const fonts = await asyncExecute(
    `const done = arguments[arguments.length - 1];
    const faces = [...document.fonts].filter((face) => face.family.replace(/"/g, '') === 'Lato');
    Promise.all(faces.map((face) => face.load().then(() => face.status, () => 'error'))).then(done);`,
  );
  assert.deepEqual(fonts, ['loaded', 'loaded', 'loaded']);
  await execute(
    'const input = document.querySelector("#css"); input.value = ":root { --slick-firefox-smoke: 2; }"; input.dispatchEvent(new Event("input", {bubbles:true})); document.querySelector("#save-css").click();',
  );
  await until(
    () => execute('return document.querySelector("#css-status")?.textContent'),
    (value) => value === 'Saved',
    'CSS save',
  );
  assert.equal(await execute('return document.querySelector("#error").hidden'), true);
  console.log('PASS: standalone options UI loads, reflects settings, acknowledges CSS saves.');
  await command('/window', { handle: slackHandle });
  assert.equal((await rpc('readUserCss')).value, ':root { --slick-firefox-smoke: 2; }');
  await execute("sessionStorage.setItem('slick:firefox:bypass', '1')");
  await command('/refresh', {});
  assert.equal(await execute('return window.__fixture.early'), false);
  await execute("sessionStorage.removeItem('slick:firefox:bypass')");
  await command('/refresh', {});
  assert.equal(await execute('return window.__fixture.early'), true);
  console.log('PASS: bypass and resume across reloads.');
  // Background halves: NoTrack and Click2Load block through declarativeNetRequest,
  // scoped to Slack; ClearURLs fetches its rules in the background.
  const frameOutcome = async (src: string) => {
    embedEvents.length = 0;
    await execute('const f = document.createElement("iframe"); f.src = arguments[0]; document.body.append(f);', [src]);
    const settled = await until(
      async () => embedEvents.find((e) => e.url === src && /fetchError|responseCompleted/.test(e.event)),
      Boolean,
      `frame ${src}`,
      30,
    );
    return settled!.event.startsWith('network.fetchError') ? 'blocked' : 'loaded';
  };
  const telemetry = () =>
    asyncExecute(`const done = arguments[arguments.length - 1];
      fetch('https://slackb.com/slick-smoke', { mode: 'no-cors' }).then(() => done('loaded'), () => done('blocked'));`);
  assert.equal(await telemetry(), 'blocked');
  assert.equal(await frameOutcome('https://open.spotify.com/embed/track/slick-smoke-1'), 'blocked');
  const allowed = 'https://open.spotify.com/embed/track/slick-smoke-2';
  assert.deepEqual(await rpc('plugin.call', ['Click2Load', 'allow', JSON.stringify([allowed])]), {
    ok: true,
    value: 'true',
  });
  assert.equal(await frameOutcome(allowed), 'loaded');
  const clearUrls = await rpc('plugin.call', ['ClearURLs', 'rules', '[]']);
  assert.equal(clearUrls.ok, true);
  assert.ok(Object.keys(JSON.parse(clearUrls.value).providers).length > 100);
  const setPcm = async (on: boolean) => {
    const current = (await rpc('readSettings')).value;
    const parsed = JSON.parse(current);
    parsed.plugins.PrivateChannelMapper = { enabled: true, flaron: on, mentions: on };
    assert.equal((await rpc('compareAndSwapSettings', [current, JSON.stringify(parsed)])).value, true);
  };
  const pcm = (method: string, value: string) =>
    rpc('plugin.call', ['PrivateChannelMapper', method, JSON.stringify([value])]);
  await setPcm(true);
  const byId = await until(
    () => pcm('channel', 'C0266FRGT'),
    (r: any) => r.ok,
    'Flaron channel lookup',
    20,
  );
  assert.equal(JSON.parse(byId.value), 'announcements');
  assert.match(JSON.parse((await pcm('byName', 'general')).value), /^[CG][A-Z0-9]{6,}$/);
  await setPcm(false);
  await until(
    () => pcm('channel', 'C0266FRGT'),
    (r: any) => r.ok === false && /disabled/.test(r.error),
    'Flaron off',
    10,
  );
  await execute("sessionStorage.setItem('slick:firefox:bypass', '1')");
  await command('/refresh', {});
  await until(telemetry, (outcome) => outcome === 'loaded', 'bypassed tab exempt from blocking', 10);
  await execute("sessionStorage.removeItem('slick:firefox:bypass')");
  await command('/refresh', {});
  await until(telemetry, (outcome) => outcome === 'blocked', 'blocking back after resume', 10);
  console.log(
    'PASS: NoTrack and Click2Load block via Slack-scoped rules; allow, bypass, ClearURLs rules and Flaron lookups work.',
  );
  // Toolbar icon: read the images Firefox's own UI uses for light and dark toolbars.
  const toolbarIcons = async () => {
    await command('/moz/context', { context: 'chrome' });
    try {
      return await execute(String.raw`
        // The action usually sits in the Extensions panel, outside the live DOM.
        const widget = CustomizableUI.getWidget('slick_3kh0_net-browser-action')?.forWindow(window)?.node;
        const button = widget?.querySelector('.webextension-browser-action') ?? widget;
        const style = button?.getAttribute('style') ?? '';
        const pick = (name) => {
          const decl = style.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ':'));
          return decl?.match(/\/icons\/([a-z]+)\.svg/)?.[1] ?? null;
        };
        return { light: pick('--webextension-toolbar-image'), dark: pick('--webextension-toolbar-image-dark') };
      `);
    } finally {
      await command('/moz/context', { context: 'content' });
    }
  };
  const setToolbarIcon = async (choice: string) => {
    const current = (await rpc('readSettings')).value;
    const next = JSON.stringify({ ...JSON.parse(current), toolbarIcon: choice });
    assert.equal((await rpc('compareAndSwapSettings', [current, next])).value, true);
  };
  for (const [choice, expected] of [
    ['white', { light: 'white', dark: 'white' }],
    ['black', { light: 'black', dark: 'black' }],
    ['auto', { light: 'black', dark: 'white' }],
  ] as const) {
    await setToolbarIcon(choice);
    await until(
      toolbarIcons,
      (icons: any) => icons.light === expected.light && icons.dark === expected.dark,
      `toolbar icon ${choice}`,
      20,
    ).catch(async (error) => {
      console.error('toolbar icons:', JSON.stringify(await toolbarIcons()));
      throw error;
    });
  }
  console.log('PASS: toolbar icon follows the setting (white, black, and theme-matched auto).');
  await bidi('network.removeIntercept', { intercept: intercept.intercept });
  if (liveUrl) {
    await command('/url', { url: liveUrl });
    const state = await until(
      () =>
        execute(`return {
      client: location.hostname === 'app.slack.com' && location.pathname.startsWith('/client/'),
      modules: window.__slickModuleRegistry?.size ?? 0,
      plugins: window.__slickPluginManager?.info().map(p => ({id:p.id, running:p.running, error:p.startError})) ?? [],
      theme: !!document.querySelector('[data-slick-style="theme"]'),
      css: getComputedStyle(document.documentElement).getPropertyValue('--slick-firefox-smoke').trim(),
    }`),
      // Registration precedes reconcile; wait for HumanCount to settle either way.
      (value: any) =>
        value.plugins.length === EXTENSION_PLUGINS.length && value.plugins.every((p: any) => p.running || p.error),
      'live Slack bootstrap',
      180,
    ).catch((error) => {
      console.error(`Slick console:\n${slickLog.join('\n')}`);
      throw error;
    });
    // Structural diagnostics only: never read Slack messages, tokens, or user identities.
    console.log('Live Slack structural diagnostics:', JSON.stringify(state));
    const slickErrors = slickLog.filter((line) => /^(error|warn)/.test(line));
    if (slickErrors.length) console.log(`Slick warnings/errors:\n${slickErrors.join('\n')}`);
    assert.equal(state.client, true);
    assert.ok(state.modules > 0);
    assert.deepEqual(
      state.plugins.filter((p: any) => !p.running || p.error),
      [],
    );
    assert.equal(state.theme, true);
    assert.equal(state.css, '2');
    console.log(`PASS: authenticated Slack, theme/custom CSS and all ${EXTENSION_PLUGINS.length} plugins running.`);
    // ClearURLs' renderer got its rule set from the background half (page → background → GitHub).
    await until(
      async () => slickLog.some((line) => /providers loaded/.test(line)),
      Boolean,
      'ClearURLs rules in Slack',
      40,
    );
    console.log('PASS: ClearURLs loaded its rules through the background half.');
    await until(
      async () => slickLog.some((line) => /logging deletes and edits \(\d+ stored/.test(line)),
      Boolean,
      'MessageLogger restore',
      40,
    );
    console.log('PASS: MessageLogger restored its log from the IndexedDB blob store.');
    // Real pointer clicks: headless keyboard shortcuts and synthetic click()
    // don't reach Slack's handlers.
    const click = async (using: string, value: string) => {
      const element = await command('/element', { using, value });
      await command(`/element/${Object.values(element)[0]}/click`, {});
    };
    const clicked = (using: string, value: string) =>
      click(using, value).then(
        () => true,
        () => false,
      );
    // AdminBackend opens its tools from a profile's overflow menu straight from
    // the page, like a link, since Firefox has no main half to hand them to.
    const before = new Set((await command('/window/handles')) as string[]);
    await execute(
      `const open = window.open; window.open = function (...args) { window.__slickOpened = args; return open.apply(this, args); }`,
    );
    await until(
      async () => {
        if (await clicked('css selector', '[data-qa="member_profile_more_btn"]')) return true;
        if (!(await clicked('xpath', "//*[@role='menuitem'][normalize-space()='Profile']")))
          await click('css selector', '[data-qa="user-button"]').catch(() => {});
        return false;
      },
      Boolean,
      'profile overflow menu',
      20,
    );
    await until(
      () => clicked('xpath', "//*[@role='menuitem'][normalize-space()='Open in Identity']"),
      Boolean,
      'Open in Identity menu item',
      10,
    );
    const adminTab = await until(
      async () => ((await command('/window/handles')) as string[]).find((handle) => !before.has(handle)),
      Boolean,
      'Identity tab',
      10,
    );
    const [opened, target, features] = await execute('return window.__slickOpened');
    assert.match(opened, /^https:\/\/auth\.hackclub\.com\/backend\/identities\?search=[UW][A-Z0-9]{6,}$/);
    assert.deepEqual([target, features], ['_blank', 'noopener,noreferrer']);
    await command('/window', { handle: adminTab });
    // Identity may bounce a signed-out profile to its login page on the same host.
    const adminUrl = await until(
      () => command('/url'),
      (url: string) => url.startsWith('https://auth.hackclub.com/'),
      'Identity URL',
      20,
    );
    await command('/window', undefined, 'DELETE');
    await command('/window', { handle: slackHandle });
    console.log(
      `PASS: AdminBackend opens Identity for the member in a new tab (landed on ${new URL(adminUrl).pathname}).`,
    );
    const streamer = () =>
      execute(`return {
        on: document.documentElement.classList.contains('slick-streamer-mode'),
        blurred: [...document.querySelectorAll('body *')].filter((e) => getComputedStyle(e).filter.includes('blur')).length,
      }`);
    assert.deepEqual(await streamer(), { on: false, blurred: 0 });
    await click('css selector', '.slick-streamer-mode__button');
    const manual = await until(
      streamer,
      (redaction: any) => redaction.on && redaction.blurred > 0,
      'StreamerMode toggle on',
      10,
    );
    await click('css selector', '.slick-streamer-mode__button');
    await until(streamer, (redaction: any) => !redaction.on && redaction.blurred === 0, 'StreamerMode toggle off', 10);
    await execute(`const button = document.createElement('button');
      button.id = 'slick-smoke-share';
      button.textContent = 'share';
      button.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647';
      button.onclick = () => navigator.mediaDevices.getDisplayMedia({ video: true }).then(
        (stream) => { window.__slickShare = stream; },
        (error) => { window.__slickShare = String(error); },
      );
      document.body.append(button);`);
    await click('css selector', '#slick-smoke-share');
    const shared = await until(
      () =>
        execute(`const s = window.__slickShare; return s === undefined ? null : typeof s === 'string' ? s : 'stream'`),
      Boolean,
      'fake screen share',
      10,
    ).catch(async (error) => {
      console.error(
        'share state:',
        JSON.stringify(
          await execute(
            `return { focus: document.hasFocus(), visible: document.visibilityState, active: navigator.userActivation?.hasBeenActive, button: !!document.getElementById('slick-smoke-share') }`,
          ),
        ),
      );
      throw error;
    });
    assert.equal(shared, 'stream');
    const sharing = await until(
      streamer,
      (redaction: any) => redaction.on && redaction.blurred > 0,
      'StreamerMode on share',
      10,
    );
    await execute(
      `window.__slickShare.getTracks().forEach((track) => track.stop()); document.getElementById('slick-smoke-share').remove();`,
    );
    await until(
      streamer,
      (redaction: any) => !redaction.on && redaction.blurred === 0,
      'StreamerMode off after share',
      10,
    );
    console.log(
      `PASS: StreamerMode blurs ${manual.blurred} elements from its toggle and ${sharing.blurred} during a screen share, then clears.`,
    );
    // Open Preferences from the account menu.
    await until(
      async () => {
        const menuItem = "//*[@role='menuitem'][normalize-space()='Preferences']";
        if (
          await click('xpath', menuItem).then(
            () => true,
            () => false,
          )
        )
          return true;
        await click('css selector', '[data-qa="user-button"]').catch(() => {});
        return false;
      },
      Boolean,
      'Preferences menu item',
      20,
    );
    await until(
      () => execute(`return !!document.querySelector('.p-prefs_dialog__modal [role="tab"][aria-label="Slick"]')`),
      Boolean,
      'Slick Preferences tab',
      40,
    ).catch(async (error) => {
      console.error(
        'prefs state:',
        JSON.stringify(
          await execute(`return {
        dialog: !!document.querySelector('.p-prefs_dialog__modal'),
        dialogs: [...document.querySelectorAll('[role="dialog"], .ReactModal__Content')].map((d) => String(d.className).slice(0, 120)),
        anyTabs: [...document.querySelectorAll('[role="tab"]')].map((t) => t.id).slice(0, 30),
        tabs: [...document.querySelectorAll('.p-prefs_dialog__modal [role="tab"]')].map((t) => [t.id, t.getAttribute('aria-label'), t.textContent.trim().slice(0, 30)]),
        active: document.activeElement?.tagName,
      }`),
        ),
      );
      console.error(`Slick console:\n${slickLog.join('\n')}`);
      throw error;
    });
    console.log('PASS: Slick tab injected into Slack Preferences.');
    await click('css selector', '.p-prefs_dialog__modal [role="tab"][aria-label="Slick"]');
    await until(
      () => execute(`return document.querySelectorAll('input[id^="slick-plugin-"]:checked').length`),
      (count: number) => count === EXTENSION_PLUGINS.length,
      'Slick plugin list',
      20,
    );
    // Toggling in Slack's UI must go through CAS into extension storage and stop the plugin.
    await click('css selector', '#slick-plugin-oneko');
    await until(
      async () => {
        const stored = JSON.parse((await rpc('readSettings')).value);
        const running = await execute(
          `return window.__slickPluginManager.info().find((p) => p.id === 'oneko').running`,
        );
        return stored.plugins.oneko.enabled === false && running === false;
      },
      Boolean,
      'plugin toggle from Preferences',
      20,
    );
    console.log('PASS: Preferences tab lists plugins; toggling persists to extension storage and stops the plugin.');
  }
} finally {
  socket?.close();
  if (session) await command('', undefined, 'DELETE').catch(() => {});
  driver?.kill();
  await rm(profile, { recursive: true, force: true });
}
