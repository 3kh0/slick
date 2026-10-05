// Real extension APIs with fictional Slack identities in a disposable profile.
// The fixture copy pregrants optional permissions; shipping manifests keep them optional.
// node scripts/account-smoke.ts [--firefox]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { zipSync } from 'fflate';

const firefox = process.argv.includes('--firefox');
const temporary = await mkdtemp(path.join(tmpdir(), 'slick-account-test-'));
const extension = path.join(temporary, 'extension');
await cp(`dist/extension/${firefox ? 'firefox' : 'chromium'}`, extension, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
manifest.permissions.push(...manifest.optional_permissions);
manifest.host_permissions.push(...manifest.optional_host_permissions);
delete manifest.optional_permissions;
delete manifest.optional_host_permissions;
await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
if (firefox) {
  // Firefox BiDi excludes extension-background fetches from network interception.
  // Stub only this fictional endpoint in the fixture copy, using real cookie APIs.
  const stub = `const accountTestFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  if(new URL(String(input)).href==='https://example.slack.com/api/auth.test'){
    const api=globalThis.browser??chrome;
    const token=new URLSearchParams(init.body).get('token');
    const jar=await api.cookies.getAll({domain:'slack.com'});
    const revoked=(await api.storage.local.get('slick:accountTestRejectBeta'))['slick:accountTestRejectBeta'];
    const a=token==='token-a'&&jar.some(c=>c.name==='d'&&c.value==='cookie-a');
    const b=token==='token-b'&&jar.some(c=>c.name==='d'&&c.value==='cookie-b')&&!revoked;
    return new Response(JSON.stringify({ok:a||b,user_id:a?'U111111':b?'U222222':undefined,error:a||b?undefined:'invalid_auth'}));
  }
  return accountTestFetch(input,init);
};\n`;
  const background = path.join(extension, 'background.js');
  await writeFile(background, stub + (await readFile(background, 'utf8')));
}
const fixture = `<!doctype html><meta charset="utf-8"><title>Fictional Slack session</title>
<script>
if (!localStorage.getItem('localConfig_v2')) localStorage.setItem('localConfig_v2', JSON.stringify({teams:{T111111:{user_id:'U111111',token:'token-a',url:'https://example.slack.com/'}},orderedTeamIds:['T111111'],lastActiveTeamId:'T111111'}));
window.accountFixtureUser = JSON.parse(localStorage.getItem('localConfig_v2')).teams.T111111?.user_id;
</script><p>Local account-switching fixture. No Slack messages or real credentials.</p>`;
let rejectBeta = false;
let holdBeta = false;
let betaHeld = false;
let child: ReturnType<typeof spawn> | undefined;
let socket: WebSocket | undefined;
let sequence = 0;
const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
let send: (method: string, params?: any, session?: string) => Promise<any>;
let evaluate: (target: string, expression: string) => Promise<any>;
let navigate: (target: string, url: string) => Promise<void>;
let createTab: (url: string) => Promise<string>;
let restartWorker: () => Promise<void>;
let manager = '';
let extensionRoot = '';
let webdriverSession = '';
const endpoint = 'http://127.0.0.1:4448';

async function until<T>(work: () => Promise<T>, check: (value: T) => boolean, label: string) {
  for (let i = 0; i < 120; i++) {
    const value = await work();
    if (check(value)) return value;
    await delay(250);
  }
  throw new Error(label + ' timed out');
}
async function authResult(body: string, cookieHeader: string) {
  const token = new URLSearchParams(body).get('token');
  // Fetch interception does not expose Cookie headers on every engine/version.
  const cookie =
    cookieHeader ||
    (await evaluate(
      manager,
      `(async()=>{const api=globalThis.browser??chrome;const all=await api.cookies.getAll({domain:'slack.com'});return all.filter(c=>c.name==='d').map(c=>'d='+c.value).join(';');})()`,
    ));
  const a = token === 'token-a' && cookie.includes('d=cookie-a');
  const b = token === 'token-b' && cookie.includes('d=cookie-b') && !rejectBeta;
  return JSON.stringify({
    ok: a || b,
    user_id: a ? 'U111111' : b ? 'U222222' : undefined,
    error: a || b ? undefined : 'invalid_auth',
  });
}
function response(url: string) {
  if (new URL(url).pathname === '/api/auth.test') return null;
  return new URL(url).pathname === '/robots.txt' ? 'User-agent: *\nDisallow: /' : fixture;
}
async function http(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const result = (await fetch(endpoint + route, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then((r) => r.json())) as any;
  if (result.value?.error) throw new Error('WebDriver: ' + result.value.error);
  return result.value;
}
const command = (route: string, body?: unknown, method?: string) =>
  http(`/session/${webdriverSession}${route}`, body, method);

try {
  if (firefox) {
    const files: Record<string, Uint8Array> = {};
    async function collect(dir: string) {
      for (const entry of await readdir(path.join(extension, dir), { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await collect(file);
        else files[file] = await readFile(path.join(extension, file));
      }
    }
    await collect('');
    const xpi = path.join(temporary, 'fixture.xpi');
    await writeFile(xpi, zipSync(files));
    child = spawn(
      'geckodriver',
      ['--port', '4448', '--websocket-port', '0', '--log', 'fatal', '--allow-system-access'],
      { stdio: 'ignore' },
    );
    await until(() => http('/status').catch(() => null), Boolean, 'geckodriver');
    const session = await http('/session', {
      capabilities: {
        alwaysMatch: {
          browserName: 'firefox',
          webSocketUrl: true,
          'moz:firefoxOptions': { binary: '/Applications/Firefox.app/Contents/MacOS/firefox', args: ['-headless'] },
        },
      },
    });
    webdriverSession = session.sessionId;
    await command('/timeouts', { script: 60000, pageLoad: 60000 });
    await command('/moz/addon/install', { path: xpi, temporary: true });
    socket = new WebSocket(session.capabilities.webSocketUrl);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener('open', () => resolve(), { once: true });
      socket!.addEventListener('error', () => reject(new Error('Firefox BiDi failed')), { once: true });
    });
    send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        socket!.send(JSON.stringify({ id, method, params }));
      });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const task = pending.get(message.id);
        pending.delete(message.id);
        message.type === 'error' ? task?.reject(new Error(message.error)) : task?.resolve(message.result);
      } else if (message.method === 'network.beforeRequestSent' && message.params.isBlocked) {
        void (async () => {
          const request = message.params.request;
          const cookies = request.headers
            .filter((h: any) => h.name.toLowerCase() === 'cookie')
            .map((h: any) => h.value.value)
            .join(';');
          // Synthetic tokens only; for POST interception BiDi may omit the body.
          const body = request.url.endsWith('/api/auth.test')
            ? await evaluate(manager, `globalThis.__accountTestToken || ''`)
            : '';
          const payload = response(request.url) ?? (await authResult(body, cookies));
          await send('network.provideResponse', {
            request: request.request,
            statusCode: 200,
            headers: [
              {
                name: 'Content-Type',
                value: {
                  type: 'string',
                  value: request.url.endsWith('/api/auth.test')
                    ? 'application/json'
                    : request.url.endsWith('/robots.txt')
                      ? 'text/plain'
                      : 'text/html',
                },
              },
            ],
            body: { type: 'string', value: payload },
          });
        })().catch((error) => textError(error));
      }
    });
    await send('session.subscribe', { events: ['network.beforeRequestSent'] });
    await send('network.addIntercept', {
      phases: ['beforeRequestSent'],
      urlPatterns: [
        { type: 'string', pattern: 'https://app.slack.com/client/T111111' },
        { type: 'string', pattern: 'https://app.slack.com/client/T111111/C111111' },
        { type: 'string', pattern: 'https://app.slack.com/robots.txt' },
        { type: 'string', pattern: 'https://app.slack.com/signin' },
        { type: 'string', pattern: 'https://example.slack.com/api/auth.test' },
      ],
    });
    // Find the temporary add-on's origin in Firefox's privileged test context.
    await command('/moz/context', { context: 'chrome' });
    extensionRoot = await command('/execute/sync', {
      script: `return WebExtensionPolicy.getByID('slick@3kh0.net').getURL('');`,
      args: [],
    });
    await command('/moz/context', { context: 'content' });
    createTab = async (url) => {
      if (!url.startsWith('moz-extension:')) {
        const tab = await send('browsingContext.create', { type: 'tab' });
        await send('browsingContext.navigate', { context: tab.context, url, wait: 'complete' });
        return tab.context;
      }
      await command('/moz/context', { context: 'chrome' });
      await command('/execute/sync', {
        script: `window.__accountTestTab=gBrowser.addTab('about:blank',{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});gBrowser.selectedTab=window.__accountTestTab;`,
        args: [],
      });
      await until(
        () =>
          command('/execute/sync', {
            script: `const b=window.__accountTestTab.linkedBrowser;if(b.currentURI.spec===arguments[0])return true;b.fixupAndLoadURIString(arguments[0],{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});return false;`,
            args: [url],
          }),
        Boolean,
        'Firefox account manager',
      );
      await command('/moz/context', { context: 'content' });
      const tree = await send('browsingContext.getTree', {});
      return tree.contexts.find((t: any) => t.url === url).context;
    };
    navigate = async (target, _url) => {
      await send('browsingContext.reload', { context: target, wait: 'complete' });
    };
    evaluate = async (target, expression) => {
      const result = await send('script.evaluate', {
        target: { context: target },
        expression: `(async()=>JSON.stringify(await (${expression})))()`,
        awaitPromise: true,
        resultOwnership: 'none',
      });
      if (result.type === 'exception') throw new Error('Firefox script: ' + result.exceptionDetails.text);
      return JSON.parse(result.result.value ?? 'null');
    };
    restartWorker = async () => {
      /* Firefox's persistent MV3 background is covered by a fresh UI load. */ await navigate(
        manager,
        extensionRoot + 'accounts.html',
      );
    };
  } else {
    const profile = path.join(temporary, 'profile');
    await mkdir(profile);
    child = spawn(
      '/Applications/Helium.app/Contents/MacOS/Helium',
      [
        `--user-data-dir=${profile}`,
        '--remote-debugging-port=0',
        '--no-first-run',
        '--no-default-browser-check',
        '--enable-unsafe-extension-debugging',
        `--load-extension=${extension}`,
        `--disable-extensions-except=${extension}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    const portFile = await until(
      () => readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => ''),
      Boolean,
      'Helium',
    );
    const [port, wsPath] = portFile.trim().split('\n');
    socket = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener('open', () => resolve(), { once: true });
      socket!.addEventListener('error', () => reject(new Error('Helium CDP failed')), { once: true });
    });
    send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        socket!.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
      });
    const sessions = new Map<string, string>();
    const ready = new Set<string>();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const task = pending.get(message.id);
        pending.delete(message.id);
        message.error ? task?.reject(new Error(message.error.message)) : task?.resolve(message.result);
      } else if (message.method === 'Target.attachedToTarget') {
        sessions.set(message.params.targetInfo.targetId, message.params.sessionId);
        void (async () => {
          await send(
            'Fetch.enable',
            { patterns: [{ urlPattern: 'https://app.slack.com/*' }, { urlPattern: 'https://example.slack.com/*' }] },
            message.params.sessionId,
          );
          await send('Runtime.runIfWaitingForDebugger', {}, message.params.sessionId);
          ready.add(message.params.targetInfo.targetId);
        })().catch((error) => textError(error));
      } else if (message.method === 'Fetch.requestPaused') {
        void (async () => {
          const request = message.params.request;
          if (
            holdBeta &&
            request.url.endsWith('/api/auth.test') &&
            new URLSearchParams(request.postData).get('token') === 'token-b'
          ) {
            betaHeld = true;
            return;
          }
          const header =
            (Object.entries(request.headers).find(([name]) => name.toLowerCase() === 'cookie')?.[1] as string) ?? '';
          const payload = response(request.url) ?? (await authResult(request.postData ?? '', header));
          await send(
            'Fetch.fulfillRequest',
            {
              requestId: message.params.requestId,
              responseCode: 200,
              responseHeaders: [
                {
                  name: 'Content-Type',
                  value: request.url.endsWith('/api/auth.test')
                    ? 'application/json'
                    : request.url.endsWith('/robots.txt')
                      ? 'text/plain'
                      : 'text/html',
                },
              ],
              body: Buffer.from(payload).toString('base64'),
            },
            message.sessionId,
          );
        })().catch((error) => textError(error));
      }
    });
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    const worker: any = await until(
      async () =>
        (await send('Target.getTargets')).targetInfos.find(
          (t: any) => t.type === 'service_worker' && t.url.startsWith('chrome-extension:'),
        ),
      Boolean,
      'extension worker',
    );
    const workerUrl = new URL(worker.url);
    extensionRoot = workerUrl.protocol + '//' + workerUrl.host + '/';
    createTab = async (url) => {
      const result = await send('Target.createTarget', { url: 'about:blank' });
      await until(async () => ready.has(result.targetId), Boolean, 'tab interception');
      await send('Page.navigate', { url }, sessions.get(result.targetId));
      return result.targetId;
    };
    evaluate = async (target, expression) => {
      const result = await send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        sessions.get(target),
      );
      if (result.exceptionDetails)
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    navigate = async (target, _url) => {
      await send('Page.navigate', { url: _url }, sessions.get(target));
    };
    restartWorker = async () => {
      await send('ServiceWorker.enable', {}, sessions.get(manager));
      const workers = (await send('Target.getTargets')).targetInfos.filter(
        (t: any) => t.type === 'service_worker' && t.url.startsWith(extensionRoot),
      );
      for (const activeWorker of workers) {
        const workerSession = sessions.get(activeWorker.targetId);
        if (workerSession) await send('Target.detachFromTarget', { sessionId: workerSession });
      }
      await send('ServiceWorker.stopAllWorkers', {}, sessions.get(manager));
      await until(
        async () =>
          (await send('Target.getTargets')).targetInfos.every(
            (t: any) => !workers.some((w: any) => w.targetId === t.targetId),
          ),
        Boolean,
        'worker termination',
      );
    };
  }

  manager = await createTab(extensionRoot + 'accounts.html');
  await until(
    () => evaluate(manager, `!!(globalThis.browser??globalThis.chrome)?.runtime?.id`).catch(() => false),
    Boolean,
    'account UI',
  );
  const apiExpression = '(globalThis.browser??chrome)';
  const call = (method: string, args: string[] = []) =>
    evaluate(manager, `${apiExpression}.runtime.sendMessage(${JSON.stringify({ method, args })})`);
  assert.equal(
    (await call('writeSettings', [JSON.stringify({ plugins: { AccountSwitcher: { enabled: true } } })])).ok,
    true,
  );
  const setCookie = (value: string) =>
    evaluate(
      manager,
      `${apiExpression}.cookies.set({url:'https://app.slack.com',name:'d',value:${JSON.stringify(value)},domain:'.slack.com',path:'/',secure:true,httpOnly:true,sameSite:'lax'}).then(()=>true)`,
    );
  await setCookie('cookie-a');
  const first = await createTab('https://app.slack.com/client/T111111');
  const second = await createTab('https://app.slack.com/client/T111111/C111111');
  await until(
    () => evaluate(first, 'window.accountFixtureUser').catch(() => null),
    (user) => user === 'U111111',
    'fixture account A',
  );
  await until(
    () => evaluate(second, 'window.accountFixtureUser').catch(() => null),
    (user) => user === 'U111111',
    'second Slack tab',
  );
  const status = JSON.parse((await call('account.status')).value);
  assert.equal(status.permission, true);
  assert.equal(status.tabs.length, 2);
  const source = String(status.tabs[0].id);
  const capturedAlpha = await call('account.capture', [source, 'Alpha']);
  assert.equal(capturedAlpha.ok, true, JSON.stringify(capturedAlpha));
  await setCookie('cookie-b');
  await evaluate(
    first,
    `(localStorage.setItem('localConfig_v2',JSON.stringify({teams:{T111111:{user_id:'U222222',token:'token-b',url:'https://example.slack.com/'}},orderedTeamIds:['T111111'],lastActiveTeamId:'T111111'})),true)`,
  );
  const capturedBeta = await call('account.capture', [source, 'Beta']);
  assert.equal(capturedBeta.ok, true, JSON.stringify(capturedBeta));
  console.log('PASS: real cookies, isolated capture, verified fake identities and trusted account UI');
  // Do not recapture during this synthetic switch: BiDi's request body is not exposed.
  const switched = await call('account.switch', ['U111111', '']);
  assert.equal(switched.ok, true, JSON.stringify(switched));
  for (const target of [first, second])
    await until(
      () => evaluate(target, 'window.accountFixtureUser').catch(() => null),
      (user) => user === 'U111111',
      'account A handoff',
    );
  assert.ok(!JSON.stringify((await call('account.list')).value).includes('token-'));
  assert.equal(JSON.parse((await call('account.status')).value).accounts.length, 2);
  console.log('PASS: two Slack tabs unload, session cookies change and target config applies before page boot');
  rejectBeta = true;
  if (firefox)
    await evaluate(manager, `${apiExpression}.storage.local.set({'slick:accountTestRejectBeta':true}).then(()=>true)`);
  const rejected = await call('account.switch', ['U222222', '']);
  assert.equal(rejected.ok, false);
  for (const target of [first, second])
    await until(
      () => evaluate(target, 'window.accountFixtureUser').catch(() => null),
      (user) => user === 'U111111',
      'rollback to A',
    );
  console.log('PASS: rejected saved session rolls back cookies/config and both original tabs');
  if (!firefox) {
    rejectBeta = false;
    holdBeta = true;
    const interrupted = call('account.switch', ['U222222', '']).catch(() => null);
    await until(async () => betaHeld, Boolean, 'in-flight target verification');
    await restartWorker();
    await interrupted;
    holdBeta = false;
    await until(
      async () => {
        const reply = await call('account.status').catch(() => null);
        return reply?.ok ? JSON.parse(reply.value) : null;
      },
      (state) => state && !state.recovery && !state.busy,
      'interrupted switch recovery',
    );
    for (const target of [first, second])
      await until(
        () => evaluate(target, 'window.accountFixtureUser').catch(() => null),
        (user) => user === 'U111111',
        'recovered account A',
      );
    console.log(
      'PASS: stopping the worker during cookie verification recovers the original session from the encrypted journal',
    );
  }
  await restartWorker();
  await until(
    () => call('account.list').catch(() => null),
    (reply) => reply?.ok,
    'background restart',
  );
  assert.equal(JSON.parse((await call('account.list')).value).length, 2);
  const encrypted = await evaluate(
    manager,
    `new Promise((resolve,reject)=>{const r=indexedDB.open('slick-accounts');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const tx=r.result.transaction('vault');const key=tx.objectStore('vault').get('key');const state=tx.objectStore('vault').get('state');tx.oncomplete=()=>{resolve({extractable:key.result.extractable,algorithm:key.result.algorithm.name,ciphertext:state.result.ciphertext.byteLength});r.result.close();};};})`,
  );
  assert.equal(encrypted.extractable, false);
  assert.equal(encrypted.algorithm, 'AES-GCM');
  assert.ok(encrypted.ciphertext > 100);
  assert.equal((await call('account.forget', ['U222222'])).ok, true);
  assert.equal(JSON.parse((await call('account.list')).value).length, 1);
  console.log('PASS: encrypted vault persists across background/UI restart; removal purges saved account');
  await mkdir('dist/extension', { recursive: true });
  await writeFile(
    `dist/extension/accounts-smoke-${firefox ? 'firefox' : 'helium'}.json`,
    JSON.stringify({ passed: true, fictionalAccounts: true, actualMessagesSent: 0, encrypted }, null, 2) + '\n',
  );
} finally {
  socket?.close();
  if (webdriverSession) await command('', undefined, 'DELETE').catch(() => {});
  child?.kill();
  await delay(500);
  await rm(temporary, { recursive: true, force: true });
}
function textError(error: unknown) {
  console.error('Fixture interception failed:', error instanceof Error ? error.message : 'unknown');
}
