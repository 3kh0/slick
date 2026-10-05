// Real MV3 smoke test in a disposable profile; never reads the user's browser data.
// node scripts/chromium-smoke.ts [--browser /path/to/chromium] [--keep-open]
// --ports-only skips store artwork generation and checks the live ports with --slack-url.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { EXTENSION_PLUGINS } from '../src/extension/plugins.ts';
import { browserPluginCheck } from './lib/browser-plugin-check.ts';

const args = process.argv.slice(2);
const binary = args.includes('--browser')
  ? args[args.indexOf('--browser') + 1]
  : '/Applications/Helium.app/Contents/MacOS/Helium';
const keepOpen = args.includes('--keep-open');
const connectedProfile = args.includes('--connect-profile') ? args[args.indexOf('--connect-profile') + 1] : undefined;
const liveUrl = args.includes('--slack-url') ? args[args.indexOf('--slack-url') + 1] : undefined;
if (liveUrl) {
  const url = new URL(liveUrl);
  assert.equal(url.protocol, 'https:');
  assert.ok(url.hostname === 'app.slack.com' || url.hostname.endsWith('.slack.com'));
}
const profile = connectedProfile ?? (await mkdtemp(path.join(tmpdir(), 'slick-chromium-')));
const extension = path.resolve('dist/extension/chromium');
const browser = connectedProfile
  ? null
  : spawn(
      binary,
      [
        `--user-data-dir=${profile}`,
        '--remote-debugging-port=0',
        '--no-first-run',
        '--no-default-browser-check',
        '--enable-unsafe-extension-debugging',
        `--load-extension=${extension}`,
        `--disable-extensions-except=${extension}`,
        ...(keepOpen ? [] : ['--headless=new']),
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
let launchError: Error | undefined;
browser?.on('error', (error) => {
  launchError = error;
});
let socket: WebSocket | undefined;
let succeeded = false;
let sequence = 0;
const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
const errors: string[] = [];
const events = new Map<string, Set<(params: any, session?: string) => void>>();
const on = (event: string, cb: (params: any, session?: string) => void) => {
  if (!events.has(event)) events.set(event, new Set());
  events.get(event)!.add(cb);
};
async function until<T>(fn: () => Promise<T>, ready: (value: T) => boolean, label: string, attempts = 80): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    const value = await fn();
    if (ready(value)) return value;
    await delay(250);
  }
  throw new Error(`${label} timed out`);
}
function cdp(method: string, params: unknown = {}, sessionId?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 20000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    socket!.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
  });
}
const attach = async (targetId: string) =>
  (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId as string;
async function evaluate(session: string, expression: string) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Slick MV3 test</title>
<script nonce="slick-fixture">
window.__fixture = {early: typeof Object.getOwnPropertyDescriptor(window, 'webpackChunkwebapp')?.get === 'function'};
try { eval('1'); window.__fixture.evalBlocked = false; } catch { window.__fixture.evalBlocked = true; }
window.webpackChunkwebapp = [];
window.webpackChunkwebapp.push([[1], {fixture: function(module) { module.exports = {slickFixture: true}; }}, function() {}]);
window.webpackChunkwebapp[0][1].fixture({exports:{}}, {}, function(){});
</script></head><body><h1>Slick MV3 test</h1></body></html>`;
try {
  const portFile = await until(
    async () => {
      if (launchError) throw launchError;
      if (browser && browser.exitCode !== null) throw new Error('Browser exited before debugging became available');
      return readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
    },
    Boolean,
    'browser launch',
  );
  const [port, wsPath] = portFile.trim().split('\n');
  socket = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise<void>((resolve, reject) => {
    socket!.addEventListener('open', () => resolve(), { once: true });
    socket!.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const task = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) task?.reject(new Error(`${message.error.message}`));
      else task?.resolve(message.result);
    } else for (const callback of events.get(message.method) ?? []) callback(message.params, message.sessionId);
  });
  console.log((await cdp('Browser.getVersion')).product);
  if (connectedProfile) {
    const idIndex = args.indexOf('--extension-id');
    const id = idIndex < 0 ? undefined : args[idIndex + 1];
    if (!id || !/^[a-p]{32}$/.test(id)) throw new Error('--connect-profile requires --extension-id');
    await cdp('Target.createTarget', { url: `chrome-extension://${id}/options.html` });
  }
  const worker: any = await until(
    async () =>
      (await cdp('Target.getTargets')).targetInfos.find(
        (t: any) => t.type === 'service_worker' && t.url.startsWith('chrome-extension:'),
      ),
    Boolean,
    'extension service worker',
  );
  const workerUrl = new URL(worker.url);
  const root = `${workerUrl.protocol}//${workerUrl.host}`;
  const workerSession = await attach(worker.targetId);
  await cdp('Runtime.enable', {}, workerSession);
  on('Runtime.exceptionThrown', (p) =>
    errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text),
  );
  const page = (await cdp('Target.createTarget', { url: 'about:blank' })).targetId;
  const session = await attach(page);
  await cdp('Page.enable', {}, session);
  await cdp('Runtime.enable', {}, session);
  await cdp('Fetch.enable', { patterns: [{ urlPattern: 'https://app.slack.com/client/slick-fixture' }] }, session);
  on('Fetch.requestPaused', (p, s) => {
    void cdp(
      'Fetch.fulfillRequest',
      {
        requestId: p.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'text/html' },
          {
            name: 'Content-Security-Policy',
            value:
              "default-src 'none'; script-src 'nonce-slick-fixture'; style-src 'unsafe-inline'; connect-src https://slackb.com",
          },
        ],
        body: Buffer.from(fixture).toString('base64'),
      },
      s,
    );
  });
  const navigate = async () => {
    await cdp('Page.navigate', { url: 'https://app.slack.com/client/slick-fixture' }, session);
    await until(() => evaluate(session, 'window.__fixture'), Boolean, 'fixture');
  };
  await navigate();
  assert.deepEqual(
    await evaluate(session, '({...window.__fixture, captured: !!window.getExport?.(x => x.slickFixture)})'),
    { early: true, evalBlocked: true, captured: true },
  );
  console.log('PASS: MAIN document_start, webpack interception and intact Slack CSP');
  const rpc = (method: string, rpcArgs: string[] = []) =>
    evaluate(
      session,
      `new Promise((resolve, reject) => {
    const id = 'smoke-' + Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { window.removeEventListener('message', handler); reject(new Error('RPC timeout')); }, 12000);
    const handler = event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'slick:firefox:v1' || event.data?.id !== id || event.data?.kind !== 'response') return;
      clearTimeout(timer); window.removeEventListener('message', handler); resolve(event.data.response);
    };
    window.addEventListener('message', handler);
    window.postMessage({channel:'slick:firefox:v1', kind:'request', id, method:${JSON.stringify(method)}, args:${JSON.stringify(rpcArgs)}}, location.origin);
  })`,
    );
  const prior = await rpc('readSettings');
  assert.equal(prior.ok, true);
  // Existing development profiles can predate newly bundled plugins.
  if (!connectedProfile) assert.equal(Object.keys(JSON.parse(prior.value).plugins).length, EXTENSION_PLUGINS.length);
  const config = {
    theme: 'catppuccin-mocha',
    plugins: Object.fromEntries(EXTENSION_PLUGINS.map((id) => [id, { enabled: true }])),
  };
  assert.equal((await rpc('compareAndSwapSettings', [prior.value, JSON.stringify(config)])).value, true);
  assert.equal((await rpc('writeUserCss', [':root { --slick-chromium-smoke: 1; }'])).value, true);
  assert.equal((await rpc('blob.write', ['plugin:MessageLogger', 'test', 'persisted'])).value, true);
  console.log(`PASS: same ${EXTENSION_PLUGINS.length} opt-in plugins, settings/CSS and IndexedDB bridge`);
  const options = (await cdp('Target.createTarget', { url: root + '/options.html' })).targetId;
  let ui = await attach(options);
  await until(
    () => evaluate(ui, 'document.querySelector("#settings")?.disabled'),
    (v) => v === false,
    'options UI',
  );
  assert.equal(await evaluate(ui, 'document.querySelector("#theme").value'), 'catppuccin-mocha');
  assert.equal(await evaluate(ui, 'document.querySelectorAll("#plugins input").length'), EXTENSION_PLUGINS.length);
  assert.deepEqual(
    await evaluate(
      ui,
      `Promise.all([...document.fonts].filter(f=>f.family.replace(/"/g,'')==='Lato').map(f=>f.load().then(()=>f.status)))`,
    ),
    ['loaded', 'loaded', 'loaded'],
  );
  await evaluate(
    ui,
    `document.querySelector('#css').value = ':root { --slick-chromium-smoke: 2; }'; document.querySelector('#css').dispatchEvent(new Event('input', {bubbles:true})); document.querySelector('#save-css').click()`,
  );
  await until(
    () => evaluate(ui, 'document.querySelector("#css-status").textContent'),
    (v) => v === 'Saved',
    'CSS save',
  );
  assert.equal((await rpc('readUserCss')).value, ':root { --slick-chromium-smoke: 2; }');
  for (const color of ['white', 'black']) await evaluate(ui, `chrome.action.setIcon({path:'icons/${color}.png'})`);
  console.log('PASS: options UI, all plugins listed, local fonts, CSS save and PNG icons');
  const rules = () => evaluate(ui, 'chrome.declarativeNetRequest.getSessionRules()');
  await until(rules, (v) => v.some((r: any) => r.action.type === 'block'), 'request rules');
  const blocked = await evaluate(
    session,
    `fetch('https://slackb.com/slick-smoke', {mode:'no-cors'}).then(()=>false,()=>true)`,
  );
  assert.equal(blocked, true);
  assert.equal(
    (await rpc('plugin.call', ['Click2Load', 'allow', JSON.stringify(['https://open.spotify.com/embed/track/slick'])]))
      .ok,
    true,
  );
  assert.ok((await rules()).some((r: any) => r.action.type === 'allow'));
  await evaluate(session, `sessionStorage.setItem('slick:firefox:bypass','1')`);
  await navigate();
  assert.equal(await evaluate(session, 'window.__fixture.early'), false);
  await until(
    rules,
    (v) => v.length > 0 && v.every((r: any) => r.condition.excludedTabIds?.length === 1),
    'bypass exemptions',
  );
  // Stop the real worker, then wake it through an extension UI message.
  await cdp('ServiceWorker.enable', {}, session);
  // Closing the debugger session lets stopAllWorkers terminate the extension too.
  await cdp('Target.detachFromTarget', { sessionId: workerSession });
  await cdp('ServiceWorker.stopAllWorkers', {}, session);
  await until(
    async () => (await cdp('Target.getTargets')).targetInfos.some((t: any) => t.targetId === worker.targetId),
    (v) => !v,
    'worker stopped',
  );
  const persisted = await evaluate(
    ui,
    `chrome.runtime.sendMessage({method:'blob.read',args:['plugin:MessageLogger','test']})`,
  );
  assert.deepEqual(persisted, { ok: true, value: 'persisted' });
  await until(
    rules,
    (v) => v.length > 0 && v.every((r: any) => r.condition.excludedTabIds?.length === 1),
    'restored exemptions',
  );
  console.log('PASS: Slack-scoped blocking, Click2Load allow, bypass and worker restart persistence');
  await evaluate(
    session,
    `sessionStorage.removeItem('slick:firefox:bypass'); sessionStorage.setItem('slick:firefox:safe-mode','1')`,
  );
  await navigate();
  assert.equal(await evaluate(session, 'window.__fixture.early'), true);
  await until(
    rules,
    (v) => v.length > 0 && v.every((r: any) => r.condition.excludedTabIds?.length === 1),
    'safe mode exemptions',
  );
  await evaluate(session, `sessionStorage.removeItem('slick:firefox:safe-mode')`);
  await navigate();
  assert.equal(await evaluate(session, 'window.__fixture.early'), true);
  await until(rules, (v) => v.every((r: any) => !r.condition.excludedTabIds?.length), 'resume blocking');
  assert.deepEqual(errors, []);
  // Store artwork uses only extension UI and the existing project mark.
  if (!args.includes('--ports-only')) {
    const storeDir = path.resolve('dist/extension/store');
    await mkdir(storeDir, { recursive: true });
    await cdp(
      'Emulation.setDeviceMetricsOverride',
      { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
      ui,
    );
    await evaluate(ui, "document.querySelector('#tab-plugins').click()");
    await delay(300);
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png' }, ui);
    await writeFile(path.join(storeDir, 'settings-1280x800.png'), Buffer.from(screenshot.data, 'base64'));
    const promoTarget = (
      await cdp('Target.createTarget', { url: pathToFileURL(path.resolve('packaging/chromium/promo.html')).href })
    ).targetId;
    const promo = await attach(promoTarget);
    await cdp(
      'Emulation.setDeviceMetricsOverride',
      { width: 440, height: 280, deviceScaleFactor: 1, mobile: false },
      promo,
    );
    await until(
      () =>
        evaluate(
          promo,
          'document.images.length === 1 && document.images[0].complete && document.images[0].naturalWidth > 0',
        ),
      Boolean,
      'promo artwork',
    );
    const promoImage = await cdp('Page.captureScreenshot', { format: 'png' }, promo);
    await writeFile(path.join(storeDir, 'promo-440x280.png'), Buffer.from(promoImage.data, 'base64'));
    await cdp('Target.closeTarget', { targetId: promoTarget });
    console.log('PASS: store screenshot and promotional artwork rendered locally');
  }
  if (args.includes('--test-reload')) {
    // Developer mode keeps an unpacked extension enabled after runtime.reload.
    const settingsTarget = (await cdp('Target.createTarget', { url: 'chrome://extensions/' })).targetId;
    const settingsSession = await attach(settingsTarget);
    await until(
      () => evaluate(settingsSession, 'typeof chrome.developerPrivate?.updateProfileConfiguration'),
      (value) => value === 'function',
      'extensions settings',
    );
    await evaluate(settingsSession, 'chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true})');
    await evaluate(ui, 'setTimeout(() => chrome.runtime.reload(), 0); true');
    await until(
      async () => (await cdp('Target.getTargets')).targetInfos.some((t: any) => t.targetId === options),
      (v) => !v,
      'extension reload',
    );
    assert.deepEqual(await rpc('readSettings'), { ok: false, error: 'Extension disconnected' });
    assert.deepEqual(errors, []);
    // Only a page reload installs the new content-script context.
    await navigate();
    assert.equal((await rpc('readSettings')).ok, true);
    const newOptions = (await cdp('Target.createTarget', { url: root + '/options.html' })).targetId;
    ui = await attach(newOptions);
    await until(
      () => evaluate(ui, 'document.querySelector("#settings")?.disabled'),
      (v) => v === false,
      'options after reload',
    );
    console.log(
      'PASS: stale content scripts handle extension reload without uncaught exceptions; page reload reconnects',
    );
  }
  let authenticatedSlack = false;
  if (liveUrl) {
    await cdp('Page.navigate', { url: liveUrl }, session);
    await cdp('Target.activateTarget', { targetId: page });
    console.log('Sign into Slack in the disposable Helium window. Waiting up to 10 minutes for plugin startup.');
    const state: any = await until(
      () =>
        evaluate(
          session,
          `({
      client: location.hostname === 'app.slack.com' && location.pathname.startsWith('/client/'),
      modules: window.__slickModuleRegistry?.size ?? 0,
      plugins: window.__slickPluginManager?.info().map(p=>({id:p.id,running:p.running,error:p.startError})) ?? [],
      theme: !!document.querySelector('[data-slick-style="theme"]'),
      css: getComputedStyle(document.documentElement).getPropertyValue('--slick-chromium-smoke').trim(),
    })`,
        ).catch(() => null),
      (v) => v?.plugins.length === EXTENSION_PLUGINS.length && v.plugins.every((p: any) => p.running || p.error),
      'authenticated Slack startup',
      2400,
    );
    console.log('Live Slack structural diagnostics:', JSON.stringify(state));
    assert.equal(state.client, true);
    assert.ok(state.modules > 0);
    assert.deepEqual(
      state.plugins.filter((p: any) => !p.running || p.error),
      [],
    );
    assert.equal(state.theme, true);
    assert.equal(state.css, '2');
    console.log('Ported plugin checks:', await evaluate(session, browserPluginCheck));
    authenticatedSlack = true;
    console.log(`PASS: authenticated Slack, themes/custom CSS and all ${EXTENSION_PLUGINS.length} plugins running`);
  }
  assert.deepEqual(errors, []);
  const result = {
    browser: (await cdp('Browser.getVersion')).product,
    plugins: [...EXTENSION_PLUGINS],
    passed: true,
    authenticatedSlack,
  };
  await writeFile('dist/extension/chromium-smoke.json', JSON.stringify(result, null, 2) + '\n');
  console.log('PASS: safe mode, resume; no uncaught extension exceptions');
  succeeded = true;
  if (keepOpen) {
    await cdp('Target.createTarget', { url: 'chrome://extensions/' });
    console.log(`Helium preview left open with Slick installed. Disposable profile: ${profile}`);
    browser?.unref();
  }
} finally {
  socket?.close();
  if (browser && (!keepOpen || !succeeded)) {
    browser.kill();
    await Promise.race([new Promise((resolve) => browser.once('exit', resolve)), delay(5000)]);
    await rm(profile, { recursive: true, force: true });
  }
}
