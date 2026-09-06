'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const { register, CHANNEL } = require('./desktop');
const adapter = require('../byoe/early-settings');
const settings = require('../byoe/settings-ui');
const registry = require('../../runtime/registry');

// The adapter is generic over the registry, so the fakes carry the real plugin
// list and probes rather than a hand-written pair.
const runtimePlugins = registry.map(({ id, defaultEnabled, probe }) => ({
  id,
  defaultEnabled: defaultEnabled === true,
  probe,
}));
const diagnostics = (extra = {}) => ({
  late: false,
  errors: [],
  stores: 0,
  componentHits: {},
  capabilities: {},
  installed: {},
  ...extra,
});

test('nickname adapter persistence uses existing settings without replacing other plugins', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'plugin-settings.json');
  settings.writePluginSetting(file, 'SlimMessageBox', 'hideEmoji', true);
  settings.writePluginSetting(file, 'Nicknames', 'names', { U1234567: 'Local' });
  assert.deepEqual(settings.readPluginSettings(file), {
    SlimMessageBox: { hideEmoji: true },
    Nicknames: { names: { U1234567: 'Local' } },
  });
});

test('marker gates registration; ready and subsequent sessions attach once with safe failures', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-beta-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist/early-extension'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/early-extension/desktop-preload.cjs'), '');
  const app = new EventEmitter();
  app.isReady = () => false;
  const ipcMain = new EventEmitter();
  let count = 0;
  const ses = {
    registerPreloadScript() {
      count++;
    },
  };
  const sent = [];
  const wc = { session: ses, isDestroyed: () => false, send: (...args) => sent.push(args) };
  wc.mainFrame = { url: 'https://app.slack.com/client/T1/C1' };
  const electron = { app, ipcMain, session: { defaultSession: ses }, webContents: { getAllWebContents: () => [wc] } };
  const changes = [];
  let persisted;
  let migrations = 0;
  const options = {
    root,
    electron,
    read: () => (persisted === undefined ? { enabled: [] } : { enabled: [], nicknames: persisted }),
    writeNickname: (...args) => changes.push(args),
    migrateNicknames: (names) => {
      migrations++;
      persisted = names;
    },
    log() {},
  };
  const inactive = register(options);
  assert.equal(inactive.registered(ses), false);
  assert.equal(inactive.reason(ses), 'stable installation');
  assert.equal(app.listenerCount('session-created'), 0);
  fs.writeFileSync(path.join(root, '.slick-beta'), '');
  const bridge = register(options);
  app.emit('ready');
  app.emit('session-created', ses);
  const other = {
    registerPreloadScript() {
      count++;
    },
  };
  app.emit('session-created', other);
  const unsupported = {
    registerPreloadScript() {
      throw Error('unsupported');
    },
  };
  app.emit('session-created', unsupported);
  assert.equal(count, 2);
  assert.equal(bridge.registered(other), true);
  assert.equal(bridge.reason(unsupported), 'preload registration failed');
  const event = { sender: wc, senderFrame: wc.mainFrame };
  ipcMain.emit(CHANNEL, event, { type: 'nickname', id: 'U1234567', name: '  Alice   B ' });
  assert.deepEqual(changes, [['U1234567', 'Alice B']]);
  assert.deepEqual(event.returnValue, { enabled: [] });
  assert.equal(sent.length, 1);
  ipcMain.emit(
    CHANNEL,
    { sender: wc, senderFrame: { url: wc.mainFrame.url } },
    { type: 'nickname', id: 'U1234567', name: 'bad' },
  );
  assert.equal(changes.length, 1);
  ipcMain.emit(CHANNEL, event, { type: 'migrate-nicknames', names: { U1234567: ' Local ', bad: 'ignored' } });
  assert.deepEqual(persisted, { U1234567: 'Local' });
  persisted = {};
  ipcMain.emit(CHANNEL, event, { type: 'migrate-nicknames', names: { U1234567: 'Stale' } });
  assert.deepEqual(persisted, {});
  assert.equal(migrations, 1);
});

test('adapter maps every plugin from existing settings and retains nickname persistence', () => {
  const configs = [],
    writes = [];
  let names = JSON.stringify({ U1234567: 'Local' });
  const world = vm.createContext({
    localStorage: {
      getItem: () => names,
      setItem: (_key, value) => {
        names = value;
      },
    },
    StorageEvent: function StorageEvent(type, options) {
      this.type = type;
      this.key = options.key;
    },
    dispatchEvent() {},
    __slickEarly: {
      plugins: runtimePlugins,
      configure: (value) => configs.push(value),
      diagnostics: () =>
        diagnostics({
          stores: 1,
          componentHits: { BaseMessageSender: 1, TextyButtons: 1 },
          capabilities: { net: true, dom: true, style: true },
          installed: { SilentTyping: true, Censorship: true },
        }),
    },
  });
  world.window = world;
  world.initial = {
    enabled: ['Nicknames', 'SlimMessageBox', 'SilentTyping'],
    nicknames: { U1234567: 'Local' },
    settings: { SlimMessageBox: { hideEmoji: true }, Censorship: { terms: 'secret' } },
  };
  world.send = (request) => {
    writes.push(request);
  };
  vm.runInContext(`(${adapter})(initial, send)`, world);
  const bridge = world.__slickDesktopEarly;
  const active = bridge.activate();
  assert.equal(active.Nicknames, true);
  assert.equal(active.SilentTyping, true);
  assert.equal(bridge.report().plugins.Nicknames.status, 'early');
  assert.equal(bridge.report().plugins.Censorship.status, 'disabled');
  const applied = configs.at(-1).plugins;
  assert.equal(applied.Nicknames.names.U1234567, 'Local');
  assert.equal(applied.SlimMessageBox.hideEmoji, true);
  assert.equal(applied.SilentTyping.enabled, true);
  // Settings for a plugin the user has not enabled must not activate it.
  assert.equal(applied.Censorship.enabled, false);
  assert.equal(applied.Censorship.terms, 'secret');
  bridge.nickname('U1234567', 'New');
  assert.equal(writes[0].name, 'New');
  bridge.update({ enabled: [], nicknames: { U1234567: '' }, settings: {} });
  assert.equal(configs.at(-1).plugins.SlimMessageBox.enabled, false);
  assert.deepEqual(Object.keys(configs.at(-1).plugins.Nicknames.names), []);
  assert.equal(names, '{}');
});

function adapterWindow(initial, send, probes) {
  let local = JSON.stringify({ U1234567: 'Stale' });
  let config;
  const events = [];
  const world = vm.createContext({
    setTimeout,
    localStorage: {
      getItem: () => local,
      setItem: (_key, value) => {
        local = value;
      },
    },
    StorageEvent: function StorageEvent(type, options) {
      this.type = type;
      this.key = options.key;
    },
    dispatchEvent: (event) => events.push(event),
    __slickEarly: {
      plugins: runtimePlugins,
      configure: (next) => {
        config = next;
      },
      diagnostics: probes,
    },
    initial,
    send,
  });
  world.window = world;
  vm.runInContext(`(${adapter})(initial, send)`, world);
  return { bridge: world.__slickDesktopEarly, local: () => JSON.parse(local), config: () => config, events };
}
const missingHooks = () => diagnostics();

test('fallback edits, removals and authoritative resets synchronize every window without resurrection', () => {
  let state = { enabled: ['Nicknames'], nicknames: { U1234567: 'Saved' }, settings: {} };
  const windows = [];
  const send = (request) => {
    assert.equal(request.type, 'nickname');
    const names = { ...state.nicknames };
    if (request.name) names[request.id] = request.name;
    else delete names[request.id];
    state = { ...state, nicknames: names };
    windows.forEach((win) => win.bridge.update(state));
    return state;
  };
  windows.push(adapterWindow(state, send, missingHooks), adapterWindow(state, send, missingHooks));
  windows.forEach((win) => assert.equal(win.bridge.activate().Nicknames, false));
  windows[0].bridge.nickname('U1234567', 'Edited');
  windows.forEach((win) => assert.equal(win.local().U1234567, 'Edited'));
  windows[1].bridge.nickname('U1234567', '');
  windows.forEach((win) => assert.deepEqual(win.local(), {}));
  assert.deepEqual(adapterWindow(state, send, missingHooks).local(), {});
  state = { ...state, nicknames: {} };
  windows.forEach((win) => {
    win.bridge.update(state);
    assert.deepEqual(win.local(), {});
  });
  assert.ok(windows[0].events.length >= 4);
});

test('legacy maps migrate only when absent; empty persisted maps never import localStorage', () => {
  let migrations = 0;
  const initial = { enabled: ['Nicknames'], settings: {} };
  const send = (request) => {
    assert.equal(request.type, 'migrate-nicknames');
    migrations++;
    return { ...initial, nicknames: request.names };
  };
  const first = adapterWindow(initial, send, missingHooks);
  assert.equal(first.local().U1234567, 'Stale');
  assert.equal(migrations, 1);
  const reset = adapterWindow({ ...initial, nicknames: {} }, send, missingHooks);
  assert.deepEqual(reset.local(), {});
  assert.equal(migrations, 1);
});

test('bounded activation waits for render evidence before committing and never switches after fallback', async () => {
  const d = missingHooks();
  const win = adapterWindow(
    { enabled: ['SlimMessageBox'], nicknames: {}, settings: {} },
    () => {},
    () => d,
  );
  const pending = win.bridge.activate(500);
  assert.equal(win.bridge.active.SlimMessageBox, undefined);
  setTimeout(() => {
    d.componentHits.TextyButtons = 1;
  }, 10);
  assert.equal((await pending).SlimMessageBox, true);
  const fallback = adapterWindow({ enabled: ['SlimMessageBox'], nicknames: {}, settings: {} }, () => {}, missingHooks);
  assert.equal((await fallback.bridge.activate(1)).SlimMessageBox, false);
  assert.equal(fallback.config().plugins.SlimMessageBox.enabled, false);
  assert.deepEqual(
    { ...fallback.bridge.report().plugins.SlimMessageBox },
    { status: 'legacy', reason: 'capability not observed' },
  );
  assert.equal(fallback.bridge.activate().SlimMessageBox, false);
});

test('a failing plugin falls back alone while the others keep their early hooks', async () => {
  const win = adapterWindow(
    { enabled: ['SilentTyping', 'Censorship'], nicknames: {}, settings: {} },
    () => {},
    () =>
      diagnostics({
        errors: [{ capability: 'Censorship', message: 'bad pattern' }],
        capabilities: { net: true, dom: true },
        installed: { SilentTyping: true, Censorship: true },
      }),
  );
  const active = await win.bridge.activate(1);
  assert.equal(active.SilentTyping, true);
  assert.equal(active.Censorship, false);
  assert.equal(win.config().plugins.Censorship.enabled, false);
});

test('an error outside every plugin disqualifies the whole early path', async () => {
  const win = adapterWindow(
    { enabled: ['SilentTyping'], nicknames: {}, settings: {} },
    () => {},
    () =>
      diagnostics({
        errors: [{ capability: 'module', message: 'chunk hook failed' }],
        capabilities: { net: true },
        installed: { SilentTyping: true },
      }),
  );
  assert.equal((await win.bridge.activate(50)).SilentTyping, false);
  assert.equal(win.bridge.report().plugins.SilentTyping.reason, 'runtime error');
});

test('settings manifest carries redacted beta activation status', () => {
  const beta = {
    optedIn: true,
    runtimeRevision: 'abcdef123456',
    state: 'settled',
    plugins: { NoTrack: { status: 'early', reason: '' } },
  };
  const manifest = settings.buildManifest({
    catalog: { plugins: [], themes: [] },
    enabled: [],
    activeTheme: '',
    pluginSettings: {},
    customCss: '',
    update: null,
    beta,
  });
  assert.deepEqual(manifest.beta, beta);
  assert.match(fs.readFileSync(path.join(__dirname, '../byoe/settings-renderer.js'), 'utf8'), /Copy beta report/);
});

test('active composer keeps narrow legacy hide rules without duplicating layout', () => {
  const plugin = require('../../plugins/SlimMessageBox');
  const css = plugin.css({ discordLayout: false, hideBroadcast: true });
  assert.match(css, /broadcast_controls/);
  assert.doesNotMatch(css, /slick-smb-stacked/);
  const inject = fs.readFileSync(path.join(__dirname, '../byoe/inject.js'), 'utf8');
  assert.match(inject, /fn\(\{ \.\.\.values, discordLayout: false \}\)/);
  const renderer = fs.readFileSync(path.join(__dirname, '../../plugins/Nicknames/renderer.js'), 'utf8');
  assert.match(renderer, /__slickDesktopEarly\?\.nickname\(id, nick\)/);
});

test('early activation drops each legacy renderer except the ones that own extra UI', () => {
  const { loadPlugins, buildCatalog } = require('../byoe/plugins');
  const pluginsDir = path.join(__dirname, '../../plugins');
  const names = registry.map(({ id }) => id);
  const loaded = loadPlugins({
    catalog: buildCatalog({ pluginsDir, themesDir: path.join(__dirname, '../../themes'), only: names }),
    enabled: names,
    electron: { app: { getPath: () => os.tmpdir(), whenReady: () => new Promise(() => {}) } },
    settings: {},
  });
  const early = Object.fromEntries(names.map((name) => [name, true]));
  const kept = loaded.js.filter(({ name, coexist }) => coexist || !early[name]).map(({ name }) => name);
  // Nicknames keeps the profile-menu editor; CustomFonts keeps uploaded-file
  // handling. Both suppress only the work the early runtime already owns.
  assert.deepEqual(
    kept.filter((name) => names.includes(name)),
    ['Nicknames', 'CustomFonts'],
  );
  assert.ok(kept.includes('slick-dom-hub'), 'shared infrastructure is never a plugin renderer');
});

test('late or unrecognized runtime retains legacy plugins and disables early effects', () => {
  let last;
  const window = {
    __slickEarly: {
      plugins: runtimePlugins,
      diagnostics: () => diagnostics({ late: true, componentHits: { TextyButtons: 1 } }),
      configure: (config) => {
        last = config;
      },
    },
  };
  const world = vm.createContext({ window, localStorage: { getItem: () => '{}' } });
  vm.runInContext(
    `(${adapter})({enabled:['SlimMessageBox'],settings:{SlimMessageBox:{hideEmoji:true}}}, () => {})`,
    world,
  );
  assert.equal(window.__slickDesktopEarly.activate().SlimMessageBox, false);
  assert.equal(last.plugins.SlimMessageBox.enabled, false);
});
