'use strict';

const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-early-test-'));
app.setPath('userData', profile);
fs.mkdirSync(path.join(profile, 'dist/early-extension'), { recursive: true });
fs.copyFileSync(
  path.resolve(__dirname, '../../dist/early-extension/desktop-preload.cjs'),
  path.join(profile, 'dist/early-extension/desktop-preload.cjs'),
);
fs.writeFileSync(path.join(profile, '.slick-beta'), '');
const REGISTRY = require('../../runtime/registry').map(({ id }) => id);
const FIXTURE_ENABLED = [
  'NoTrack',
  'SilentTyping',
  'ClearURLs',
  'AnonymiseFileNames',
  'Nicknames',
  'SlimMessageBox',
  'Snappy',
  'CustomFonts',
  'Censorship',
];
for (const id of FIXTURE_ENABLED) {
  if (!REGISTRY.includes(id)) throw new Error(`fixture plugin missing from registry: ${id}`);
}
let desktopSettings = { enabled: FIXTURE_ENABLED, nicknames: {}, settings: {} };
const desktop = require('./desktop').register({
  electron: require('electron'),
  root: profile,
  read: () => desktopSettings,
  writeNickname(id, name) {
    const names = { ...desktopSettings.nicknames };
    if (name) names[id] = name;
    else delete names[id];
    desktopSettings = { ...desktopSettings, nicknames: names };
  },
});
app.whenReady().then(async () => {
  let win;
  let secondWindow;
  let pluginWindow;
  try {
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/composer.html'));
    const pluginsFixture = fs.readFileSync(path.join(__dirname, 'fixtures/plugins.html'));
    const page = (body) => new Response(body, { headers: { 'Content-Type': 'text/html' } });
    // Slack's API endpoints echo the request body back so the network plugins can
    // be checked end to end through the page's own fetch, not a stub.
    const serve = async (request) => {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/'))
        return new Response(JSON.stringify({ echo: await request.text() }), {
          headers: { 'Content-Type': 'application/json' },
        });
      if (url.pathname.includes('plugins')) return page(pluginsFixture);
      return page(fixture);
    };
    await session.defaultSession.protocol.handle('https', serve);
    win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    win.webContents.on('console-message', (_event, _level, message) => console.log(message));
    win.webContents.on('preload-error', (_event, file, error) => console.error(file, error));
    const evaluate = (code) => win.webContents.executeJavaScript(code);
    await win.loadURL('https://app.slack.com/client/slick-test');
    const result = await evaluate(`(async () => {
      const settle = () => new Promise(resolve => setTimeout(resolve, 150));
      const scope = document.querySelector('#composer');
      const editor = scope.querySelector('.ql-editor');
      const stacked = () => scope.classList.contains('slick-smb-stacked');
      const checks = { early: fixture.early, evalBlocked: fixture.evalBlocked, initial: fixture.initial, lazy: loadLazyFixture() };
      await settle(); checks.restoredMultiline = stacked();
      editor.innerHTML = '<p>Short draft</p>';
      await settle(); checks.restoredSingleline = !stacked();
      editor.textContent = 'a '.repeat(20);
      await settle(); checks.wide = !stacked();
      scope.style.width = '160px';
      await settle(); checks.narrow = stacked();
      scope.style.width = '600px';
      await settle(); checks.wideAgain = !stacked();
      const attachment = document.createElement('div'); attachment.className = 'c-pending_files'; scope.append(attachment);
      await settle(); checks.attachment = stacked();
      attachment.remove(); await settle(); checks.attachmentRemoved = !stacked();
      editor.innerHTML = '<p>one</p><p>two</p>';
      await settle();
      __slickEarly.configure({ enabled: false });
      await settle(); checks.disabled = !stacked() && !document.querySelector('#slick-early-composer').textContent;
      __slickEarly.configure({});
      await settle(); checks.reenabled = stacked();
      const second = scope.cloneNode(true); second.id = 'second'; second.querySelector('.ql-editor').textContent = 'short'; document.body.append(second);
      await settle(); checks.secondComposer = !second.classList.contains('slick-smb-stacked') && stacked();
      let mutations = 0;
      const observer = new MutationObserver(records => mutations += records.length);
      observer.observe(scope, { attributes: true, attributeFilter: ['class'] });
      await new Promise(resolve => setTimeout(resolve, 600));
      checks.idleClassMutations = mutations; observer.disconnect();
      second.remove(); await settle();
      checks.errors = __slickEarly.diagnostics().errors;
      return checks;
    })()`);
    // A second document exercises the ported plugins against a real DOM, real
    // fetch/WebSocket prototypes and the same strict CSP.
    pluginWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    pluginWindow.webContents.on('console-message', (_event, _level, message) => console.log(message));
    await pluginWindow.loadURL('https://app.slack.com/client/plugins');
    const plugins = await pluginWindow.webContents.executeJavaScript(`(async () => {
      const settle = () => new Promise(resolve => setTimeout(resolve, 120));
      const runtime = window.__slickEarly;
      const rules = { providers: { global: { urlPattern: '.*', rules: ['utm_.*'], rawRules: [], exceptions: [] } } };
      const base = {
        Censorship: { enabled: true, terms: 'job', style: 'stars' },
        Snappy: { enabled: true, disableSpellcheck: true },
        CustomFonts: { enabled: true, fontFamily: 'Comic Sans MS' },
        SilentTyping: { enabled: true },
        NoTrack: { enabled: true },
        ClearURLs: { enabled: true, rules },
        AnonymiseFileNames: { enabled: true },
      };
      const apply = (overrides = {}) => runtime.configure({ plugins: { ...base, ...overrides } });
      const checks = { early: fixture.early, evalBlocked: fixture.evalBlocked };
      apply();
      await settle();
      checks.censored = document.getElementById('line-one').textContent === 'I applied for a *** today';
      checks.codeUntouched = document.getElementById('snippet').textContent === 'job()';
      checks.draftUntouched = document.getElementById('draft').textContent === 'my job draft';
      const later = document.createElement('div');
      later.className = 'c-message__body';
      later.textContent = 'another job posting';
      document.getElementById('messages').append(later);
      await settle();
      checks.censoredLater = later.textContent === 'another *** posting';
      apply({ Censorship: { enabled: false } });
      await settle();
      checks.censorRestored = document.getElementById('line-one').textContent === 'I applied for a job today';
      apply();
      await settle();
      checks.spellcheck = document.querySelector('#composer .ql-editor').getAttribute('spellcheck') === 'false';
      checks.snappyCss = document.getElementById('slick-early-snappy').textContent.includes('transition-duration');
      checks.fontCss = document.getElementById('slick-early-fonts').textContent.includes('Comic Sans MS');
      apply({ Snappy: { enabled: false }, CustomFonts: { enabled: false } });
      await settle();
      checks.spellcheckRestored = document.querySelector('#composer .ql-editor').getAttribute('spellcheck') === 'true';
      checks.fontCssCleared = document.getElementById('slick-early-fonts').textContent === '';
      apply();
      // A dropped frame returns before reaching the native send; anything else
      // reaches it and throws for this detached stub.
      const stub = Object.create(WebSocket.prototype);
      const sent = (data) => { try { WebSocket.prototype.send.call(stub, data); return true; } catch { return false; } };
      checks.typingDropped = sent(JSON.stringify({ type: 'user_typing', channel: 'C1' }));
      checks.otherFramesPass = !sent(JSON.stringify({ type: 'ping' }));
      apply({ SilentTyping: { enabled: false } });
      checks.typingRestored = !sent(JSON.stringify({ type: 'user_typing' }));
      apply();
      checks.blocked = (await fetch('https://slack.com/clog/track', { method: 'POST', body: 'x' })).status === 204;
      const posted = await fetch('https://app.slack.com/api/chat.postMessage', {
        method: 'POST',
        body: JSON.stringify({ text: 'see https://n.example.com/a?utm_source=slack&keep=1' }),
      });
      const echoed = JSON.parse((await posted.json()).echo);
      checks.cleaned = echoed.text === 'see https://n.example.com/a?keep=1';
      const masked = new File(['x'], 'holiday-photo.PNG', { type: 'image/png' });
      checks.masked = /^[a-z0-9]{7}\\.PNG$/.test(masked.name);
      checks.stableMask = masked.name === masked.name;
      apply({ AnonymiseFileNames: { enabled: false } });
      checks.maskRestored = masked.name === 'holiday-photo.PNG';
      const diagnostics = runtime.diagnostics();
      checks.counters = diagnostics.counters;
      checks.errors = diagnostics.errors;
      checks.capabilities = diagnostics.capabilities;
      return checks;
    })()`);
    assert.deepEqual(plugins.errors, []);
    for (const [key, value] of Object.entries(plugins)) {
      if (['counters', 'errors', 'capabilities'].includes(key)) continue;
      assert.equal(value, true, `plugins fixture: ${key}`);
    }
    for (const capability of ['net', 'dom', 'style', 'text'])
      assert.equal(plugins.capabilities[capability], true, `capability ${capability}`);
    for (const counter of ['SilentTyping.dropped', 'NoTrack.blocked', 'ClearURLs.cleaned', 'Censorship.masked'])
      assert.ok(plugins.counters[counter] > 0, `counter ${counter}`);
    const pluginActivation = await pluginWindow.webContents.executeJavaScript('__slickDesktopEarly.activate(200)');
    for (const id of [
      'NoTrack',
      'SilentTyping',
      'ClearURLs',
      'AnonymiseFileNames',
      'Snappy',
      'CustomFonts',
      'Censorship',
    ])
      assert.equal(pluginActivation[id], true, `activation ${id}`);
    assert.equal(
      pluginActivation.Nicknames,
      false,
      'no message sender rendered, so Nicknames stays on the legacy path',
    );

    const secondSession = session.fromPartition('slick-beta-second');
    await secondSession.protocol.handle('https', serve);
    secondWindow = new BrowserWindow({
      show: false,
      webPreferences: { session: secondSession, sandbox: true, contextIsolation: true },
    });
    await secondWindow.loadURL('https://app.slack.com/client/second');
    const secondEvaluate = (code) => secondWindow.webContents.executeJavaScript(code);
    assert.equal(await evaluate('__slickDesktopEarly.activate().Nicknames'), false);
    assert.equal(await secondEvaluate('__slickDesktopEarly.activate().Nicknames'), false);
    await evaluate("__slickDesktopEarly.nickname('U1234567', 'Shared')");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await secondEvaluate("JSON.parse(localStorage.getItem('slick:nicknames')).U1234567"), 'Shared');
    await secondEvaluate("__slickDesktopEarly.nickname('U1234567', '')");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await evaluate("localStorage.getItem('slick:nicknames')"), '{}');
    await evaluate("__slickDesktopEarly.nickname('U1234567', 'Reset me')");
    desktopSettings = { ...desktopSettings, nicknames: {} };
    desktop.publish();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await evaluate("localStorage.getItem('slick:nicknames')"), '{}');
    assert.equal(await secondEvaluate("localStorage.getItem('slick:nicknames')"), '{}');
    if (process.env.SLICK_FIXTURE_FORCE_FAILURE === '1') throw new Error('forced fixture failure');
    assert.equal(result.initial, 'initial');
    assert.equal(result.lazy, 'lazy');
    assert.equal(result.idleClassMutations, 0, 'layout must settle without an observer feedback loop');
    assert.deepEqual(result.errors, []);
    for (const [key, value] of Object.entries(result)) {
      if (['initial', 'lazy', 'idleClassMutations', 'errors'].includes(key)) continue;
      assert.equal(value, true, key);
    }
    console.log(
      'Electron CSP, early/lazy modules, draft restoration, resizing, attachments, settings, multiple composers, ' +
        'idle checks and the ported text/DOM/style/network plugins passed.',
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    secondWindow?.destroy();
    pluginWindow?.destroy();
    win?.destroy();
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  }
});
app.on('will-quit', () => fs.rmSync(profile, { recursive: true, force: true }));
