'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const bundle = require('../../runtime/bundle');
const nicknames = require('../../runtime/plugins/nicknames');
const slim = require('../../runtime/plugins/slim-message-box');

// Every test installs through the real bundle source, so descriptor
// serialization is covered by the same suites that cover behaviour.
function environment(plugins = [], globals = {}) {
  const world = vm.createContext({
    performance,
    location: { origin: 'https://app.slack.com', href: 'https://app.slack.com/client/T1/C1' },
    addEventListener() {},
    ...globals,
  });
  world.window = world;
  vm.runInContext(bundle.source(plugins), world);
  world.rspackChunkwebapp = [];
  const modules = {};
  const cache = {};
  function require(id) {
    if (cache[id]) return cache[id].exports;
    const module = (cache[id] = { exports: {} });
    try {
      modules[id].call(module.exports, module, module.exports, require);
    } catch (error) {
      delete cache[id];
      throw error;
    }
    return module.exports;
  }
  const parent = world.rspackChunkwebapp.push.bind(world.rspackChunkwebapp);
  world.rspackChunkwebapp.push = function (chunk) {
    Object.assign(modules, chunk[1]);
    if (chunk[2]) chunk[2](require);
    return parent(chunk);
  };
  return { world, require, push: (entries, run) => world.rspackChunkwebapp.push([['chunk'], entries, run]) };
}

function mockReact(label = 'default') {
  return {
    Component: class Component {
      constructor(props) {
        this.props = props;
        this.updates = 0;
      }
      forceUpdate() {
        this.updates++;
      }
    },
    forwardRef: (callback) => ({ render: callback }),
    createElement: (type, props) => ({ type, props, renderer: label }),
    useState() {},
    useSyncExternalStore() {
      throw new Error('Wrapper must not use a global hook dispatcher');
    },
  };
}
function subscription(node, ref = null) {
  const inner = node.type.render(node.props, ref);
  return new inner.type(inner.props);
}
function render(node, ref = null) {
  return subscription(node, ref).render();
}

test('runtime push replacement chains do not recurse; initial and lazy modules execute once', () => {
  const env = environment();
  let executed = 0;
  env.push(
    {
      a(module) {
        executed++;
        module.exports = 42;
      },
    },
    (require) => assert.equal(require('a'), 42),
  );
  env.push({
    b(module) {
      executed++;
      module.exports = 7;
    },
  });
  assert.equal(executed, 1);
  assert.equal(env.require('b'), 7);
  assert.equal(env.require('a'), 42);
  assert.equal(executed, 2);
  assert.equal(env.world.__slickEarly.diagnostics().modules, 2);
});

test('preserves factory this, errors, circular module access and exports', () => {
  const env = environment();
  env.push({
    a(module, exports, require) {
      assert.equal(this, exports);
      exports.value = 3;
      exports.other = require('b');
    },
    b(module, exports, require) {
      module.exports = require('a').value;
    },
    bad() {
      throw new Error('original error');
    },
  });
  assert.equal(env.require('a').other, 3);
  assert.throws(() => env.require('bad'), /original error/);
});

test('nickname reads stay stable and never mutate original state; disable restores names', () => {
  const env = environment([nicknames]);
  const member = Object.freeze({ profile: Object.freeze({ display_name: 'Original' }) });
  const raw = Object.freeze({ members: Object.create({ U123: member }) });
  const store = { getState: () => raw, dispatch() {} };
  env.push({
    redux(module) {
      function createStore() {
        return store;
      }
      Object.defineProperty(module.exports, 'Yl', { enumerable: true, get: () => createStore });
    },
  });
  assert.equal(env.require('redux').Yl(), store);
  env.world.__slickEarly.configure({ nicknames: { U123: 'Local' } });
  const view = store.getState();
  assert.equal(view.members.U123.profile.display_name, 'Local');
  assert.equal(store.getState(), view);
  assert.equal(raw.members.U123.profile.display_name, 'Original');
  assert.equal(Object.keys(raw.members).length, 0);
  env.world.__slickEarly.configure({ enabled: false });
  assert.equal(store.getState(), raw);
});

test('message sender wrappers override displayed names without wrapping unrelated types', () => {
  const env = environment([nicknames]);
  const React = mockReact();
  env.push({
    react(module) {
      module.exports = React;
    },
    jsx(module) {
      module.exports = { jsx: React.createElement, jsxs: React.createElement };
    },
  });
  env.require('react');
  const jsx = env.require('jsx');
  function BaseMessageSender() {}
  BaseMessageSender.displayName = 'BaseMessageSender';
  function Unrelated() {}
  env.world.__slickEarly.configure({ nicknames: { U123: 'Local' } });
  const first = jsx.jsx(BaseMessageSender, { userId: 'U123' });
  assert.equal(jsx.jsx(BaseMessageSender, { userId: 'U123' }).type, first.type);
  assert.equal(render(first).props.overrideNameText, 'Local');
  assert.equal(jsx.jsx(Unrelated, { userId: 'U123' }).type, Unrelated);
  env.world.__slickEarly.configure({ enabled: false });
  assert.equal(render(first).props.overrideNameText, undefined);
});

test('React wrappers render the original once, keep stable identity and preserve unrelated components', () => {
  const env = environment([slim]);
  const React = mockReact();
  env.push({
    react(module) {
      module.exports = React;
    },
    jsx(module) {
      module.exports = { jsx: React.createElement, jsxs: React.createElement };
    },
  });
  env.require('react');
  const jsx = env.require('jsx');
  function TextyButtons() {}
  function Unrelated() {}
  env.world.__slickEarly.configure({ slim: { hideEmoji: true } });
  const first = jsx.jsx(TextyButtons, { enableEmojiButton: true });
  assert.equal(jsx.jsx(TextyButtons, {}).type, first.type);
  const rendered = render(first);
  assert.equal(rendered.type, TextyButtons);
  assert.equal(rendered.props.enableEmojiButton, false);
  assert.equal(jsx.jsx(Unrelated, {}).type, Unrelated);
  env.world.__slickEarly.configure({ enabled: false });
  assert.equal(render(first).props.enableEmojiButton, true);
});

test('distinct React and JSX runtimes retain their own creator without crossing hook dispatchers', () => {
  const env = environment([slim]);
  const a = mockReact('A'),
    b = mockReact('B');
  const jsxA = {
    jsx: (type, props) => ({ type, props, renderer: 'jsxA' }),
    jsxs: (type, props) => ({ type, props, renderer: 'jsxA' }),
  };
  const jsxB = {
    jsx: (type, props) => ({ type, props, renderer: 'jsxB' }),
    jsxs: (type, props) => ({ type, props, renderer: 'jsxB' }),
  };
  env.push({
    a(m) {
      m.exports = a;
    },
    b(m) {
      m.exports = b;
    },
    jsxA(m) {
      m.exports = jsxA;
    },
    jsxB(m) {
      m.exports = jsxB;
    },
  });
  env.require('a');
  env.require('jsxA');
  function TextyButtons() {}
  const first = a.createElement(TextyButtons, {});
  env.require('b');
  env.require('jsxB');
  assert.equal(render(first).renderer, 'A');
  assert.equal(render(b.createElement(TextyButtons, {})).renderer, 'B');
  assert.equal(render(jsxA.jsx(TextyButtons, {})).renderer, 'jsxA');
  assert.equal(render(jsxB.jsx(TextyButtons, {})).renderer, 'jsxB');
  assert.notEqual(first.type, b.createElement(TextyButtons, {}).type);
});

test('subscriptions refresh on settings changes, forward refs, and unsubscribe on unmount', () => {
  const env = environment([slim]);
  const react = mockReact();
  env.push({
    react(m) {
      m.exports = react;
    },
  });
  env.require('react');
  function TextyButtons() {}
  const ref = {};
  const instance = subscription(react.createElement(TextyButtons, { enableEmojiButton: true }), ref);
  instance.render();
  instance.componentDidMount();
  env.world.__slickEarly.configure({ slim: { hideEmoji: true } });
  assert.equal(instance.updates, 1);
  assert.equal(instance.render().props.enableEmojiButton, false);
  assert.equal(instance.render().props.ref, ref);
  instance.componentWillUnmount();
  env.world.__slickEarly.configure({});
  assert.equal(instance.updates, 1);
});

test('one plugin startup failure does not prevent installing the runtime', () => {
  const env = environment([
    {
      id: 'Broken',
      setup: function setup() {
        throw new Error('broken plugin');
      },
    },
    slim,
  ]);
  assert.equal(env.world.__slickEarly.diagnostics().errors[0].capability, 'plugin startup');
  env.push({
    a(m) {
      m.exports = 1;
    },
  });
  assert.equal(env.require('a'), 1);
});

test('short executable getters are not called during module discovery', () => {
  const env = environment([nicknames]);
  let reads = 0;
  const bump = () => {
    reads++;
    return undefined;
  };
  env.push({
    getterModule(m) {
      Object.defineProperties(m.exports, {
        x: { enumerable: true, get: () => bump() },
        createStore: { enumerable: true, get: () => bump() },
        getState: { enumerable: true, get: () => bump() },
      });
    },
  });
  env.require('getterModule');
  assert.equal(reads, 0);
  assert.equal(env.world.__slickEarly.diagnostics().errors.length, 0);
});

// --- registry, settings and activation ----------------------------------------

test('every registry descriptor serializes into the bundle and exposes data-only metadata', () => {
  const source = bundle.source();
  assert.doesNotThrow(() => new vm.Script(source));
  for (const plugin of bundle.registry) {
    assert.match(plugin.id, /^[A-Za-z][A-Za-z0-9]*$/);
    assert.equal(typeof plugin.setup, 'function');
    assert.ok(source.includes(`"id":${JSON.stringify(plugin.id)}`), plugin.id);
  }
  const metadata = bundle.metadata();
  assert.equal(metadata.length, bundle.registry.length);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(metadata)));
  for (const entry of metadata)
    for (const schema of Object.values(entry.settings)) assert.equal(schema.coerce, undefined);
});

test('the whole registry installs together and honours each declared default activation', () => {
  const env = environment(bundle.registry, { navigator: { userAgent: 'test' } });
  const diagnostics = env.world.__slickEarly.diagnostics();
  assert.deepEqual(
    Array.from(diagnostics.errors, (error) => error.capability),
    [],
  );
  for (const plugin of bundle.registry)
    assert.equal(diagnostics.active[plugin.id], plugin.defaultEnabled === true, plugin.id);
  assert.deepEqual(
    Array.from(env.world.__slickEarly.plugins, ({ id }) => id),
    bundle.registry.map(({ id }) => id),
  );
});

test('settings are coerced per schema, unknown keys ignored, and activation is per plugin', () => {
  const censorship = require('../../runtime/plugins/censorship');
  const env = environment([censorship, slim]);
  const runtime = env.world.__slickEarly;
  runtime.configure({
    plugins: {
      Censorship: { enabled: true, style: 'not-a-style', terms: 'alpha', bogus: 'ignored', keepFirstLetter: 'yes' },
      SlimMessageBox: { enabled: false },
    },
  });
  const active = runtime.diagnostics().active;
  assert.equal(active.Censorship, true);
  assert.equal(active.SlimMessageBox, false);
  runtime.configure({ enabled: false, plugins: { Censorship: { enabled: true } } });
  assert.equal(runtime.diagnostics().active.Censorship, false, 'the global switch overrides per-plugin activation');
});

test('nickname maps reject malformed ids, oversized names and non-object payloads', () => {
  const env = environment([nicknames]);
  const store = {
    getState: () => ({ members: { U1234567: { profile: {} }, W7654321: { profile: {} } } }),
    dispatch() {},
  };
  env.push({
    redux(module) {
      module.exports = { getState: store.getState, dispatch: store.dispatch };
    },
  });
  const wrapped = env.require('redux');
  env.world.__slickEarly.configure({
    plugins: {
      Nicknames: {
        names: { U1234567: 'Fine', 'bad-id': 'nope', W7654321: 'x'.repeat(101), U0000000: '' },
      },
    },
  });
  const members = wrapped.getState().members;
  assert.equal(members.U1234567.profile.display_name, 'Fine');
  assert.equal(members.W7654321.profile.display_name, undefined);
  env.world.__slickEarly.configure({ plugins: { Nicknames: { names: 'not-an-object' } } });
  assert.equal(wrapped.getState().members.U1234567.profile.display_name, undefined);
});

test('two plugins may transform the same component and are gated independently', () => {
  const other = {
    id: 'Other',
    defaultEnabled: true,
    setup: function setup(api) {
      api.component('TextyButtons', (props) => ({ ...props, marker: 'other' }));
    },
  };
  const env = environment([slim, other]);
  const react = mockReact();
  env.push({
    react(module) {
      module.exports = react;
    },
  });
  env.require('react');
  function TextyButtons() {}
  env.world.__slickEarly.configure({ plugins: { SlimMessageBox: { hideEmoji: true }, Other: {} } });
  const element = react.createElement(TextyButtons, { enableEmojiButton: true });
  let rendered = render(element);
  assert.equal(rendered.props.enableEmojiButton, false);
  assert.equal(rendered.props.marker, 'other');
  env.world.__slickEarly.configure({ plugins: { SlimMessageBox: { hideEmoji: true }, Other: { enabled: false } } });
  rendered = render(element);
  assert.equal(rendered.props.enableEmojiButton, false);
  assert.equal(rendered.props.marker, undefined);
});

// --- network capability --------------------------------------------------------

class FakeSocket {
  constructor(url = 'wss://wss-primary.slack.com/') {
    this.url = url;
    this.sent = [];
  }
  send(data) {
    this.sent.push(data);
  }
}
function netEnvironment(plugins, extra = {}) {
  const calls = [];
  const beacons = [];
  const world = {
    URL,
    URLSearchParams,
    FormData,
    Response,
    Event: function Event(type) {
      this.type = type;
    },
    setTimeout,
    WebSocket: extra.WebSocket,
    navigator: {
      sendBeacon(url, data) {
        beacons.push([String(url), data]);
        return true;
      },
    },
    fetch(input, init) {
      calls.push({ url: String(input), body: init?.body });
      return Promise.resolve('sent');
    },
    ...extra.globals,
  };
  const env = environment(plugins, world);
  return { env, calls, beacons, world: env.world };
}

test('SilentTyping drops typing frames before Slack opens its socket and passes everything else', () => {
  const silentTyping = require('../../runtime/plugins/silent-typing');
  const { env } = netEnvironment([silentTyping], { WebSocket: FakeSocket });
  const runtime = env.world.__slickEarly;
  runtime.configure({ plugins: { SilentTyping: { enabled: true } } });
  const socket = new FakeSocket();
  socket.send(JSON.stringify({ type: 'user_typing', channel: 'C1' }));
  socket.send(JSON.stringify({ type: 'ping' }));
  socket.send('typing but not json');
  socket.send(new Uint8Array([1, 2, 3]));
  assert.equal(socket.sent.length, 3);
  assert.equal(runtime.diagnostics().counters['SilentTyping.dropped'], 1);
  runtime.configure({ plugins: { SilentTyping: { enabled: false } } });
  socket.send(JSON.stringify({ type: 'typing' }));
  assert.equal(socket.sent.length, 4);
});

test('NoTrack blocks the telemetry endpoints across fetch, XHR and beacons and leaves the API alone', async () => {
  const noTrack = require('../../runtime/plugins/no-track');
  class FakeXHR {
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    send(body) {
      this.body = body;
      this.sends = (this.sends || 0) + 1;
    }
    dispatchEvent(event) {
      (this.events ||= []).push(event.type);
    }
  }
  const { env, calls, beacons } = netEnvironment([noTrack], { globals: { XMLHttpRequest: FakeXHR } });
  const runtime = env.world.__slickEarly;
  const blocked = await env.world.fetch('https://slack.com/clog/track', { method: 'POST', body: 'x' });
  assert.equal(blocked.status, 204);
  assert.equal(calls.length, 0);
  await env.world.fetch('https://app.slack.com/api/chat.postMessage', { method: 'POST', body: 'keep' });
  assert.equal(calls.length, 1);
  const xhr = new FakeXHR();
  env.world.XMLHttpRequest.prototype.open.call(xhr, 'POST', 'https://a.slackb.com/report');
  env.world.XMLHttpRequest.prototype.send.call(xhr, 'payload');
  assert.equal(xhr.sends, undefined);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(xhr.events, ['error', 'loadend']);
  assert.equal(env.world.navigator.sendBeacon('https://slack.com/beacon/x', 'data'), true);
  assert.equal(beacons.length, 0);
  assert.equal(runtime.diagnostics().counters['NoTrack.blocked'], 3);
  runtime.configure({ plugins: { NoTrack: { enabled: false } } });
  await env.world.fetch('https://slack.com/clog/track', { method: 'POST', body: 'x' });
  assert.equal(calls.length, 2);
});

test('ClearURLs rewrites outgoing message bodies with platform rules and caps untrusted input', async () => {
  const clearUrls = require('../../runtime/plugins/clear-urls');
  const { env, calls } = netEnvironment([clearUrls]);
  const runtime = env.world.__slickEarly;
  const rules = {
    providers: { global: { urlPattern: '.*', rules: ['utm_.*', 'fbclid'], rawRules: [], exceptions: [] } },
  };
  runtime.configure({ plugins: { ClearURLs: { enabled: true, rules, extraRules: 'ref@*.example.com' } } });
  await env.world.fetch('https://app.slack.com/api/chat.postMessage', {
    method: 'POST',
    body: JSON.stringify({
      text: 'look https://news.example.com/a?utm_source=slack&keep=1 and https://x.example.com/b?ref=2',
      blocks: [{ type: 'link', url: 'https://news.example.com/c?fbclid=abc' }],
    }),
  });
  const body = JSON.parse(calls.at(-1).body);
  assert.match(body.text, /keep=1/);
  assert.doesNotMatch(body.text, /utm_source/);
  assert.doesNotMatch(body.text, /ref=2/);
  assert.equal(body.blocks[0].url, 'https://news.example.com/c');
  assert.ok(runtime.diagnostics().counters['ClearURLs.cleaned'] >= 3);
  // Unrelated endpoints are never touched.
  await env.world.fetch('https://app.slack.com/api/users.info', { method: 'POST', body: 'utm_source=x' });
  assert.equal(calls.at(-1).body, 'utm_source=x');
  const oversized = { providers: {} };
  for (let i = 0; i < 600; i++) oversized.providers[`p${i}`] = { urlPattern: '.*', rules: [] };
  oversized.providers.long = { urlPattern: 'a'.repeat(500), rules: [] };
  assert.equal(Object.keys(clearUrls.settings.rules.coerce(oversized).providers).length, 500);
  assert.equal(clearUrls.settings.rules.coerce({ providers: 'nope' }), null);
  assert.deepEqual(
    Array.from(runtime.diagnostics().errors, (error) => error.message),
    [],
  );
});

test('ClearURLs mutates FormData uploads in place because Slack keeps the reference', async () => {
  const clearUrls = require('../../runtime/plugins/clear-urls');
  const { env } = netEnvironment([clearUrls]);
  env.world.__slickEarly.configure({
    plugins: { ClearURLs: { enabled: true, rules: { providers: { g: { urlPattern: '.*', rules: ['utm_.*'] } } } } },
  });
  const form = new FormData();
  form.set('text', 'https://example.com/x?utm_source=slack');
  await env.world.fetch('https://app.slack.com/api/chat.update', { method: 'POST', body: form });
  assert.equal(form.get('text'), 'https://example.com/x');
});

test('AnonymiseFileNames keeps one stable name per file, preserves the extension and respects toggling', () => {
  const anonymise = require('../../runtime/plugins/anonymise-file-names');
  class FakeFile {
    constructor(name) {
      this.realName = name;
    }
    get name() {
      return this.realName;
    }
  }
  const env = environment([anonymise], { File: FakeFile, crypto: require('node:crypto').webcrypto, Uint32Array });
  const runtime = env.world.__slickEarly;
  const file = new FakeFile('quarterly-review.PNG');
  assert.equal(file.name, 'quarterly-review.PNG');
  runtime.configure({ plugins: { AnonymiseFileNames: { enabled: true } } });
  const masked = file.name;
  assert.match(masked, /^[a-z0-9]{7}\.PNG$/);
  assert.equal(file.name, masked, 'the same File must not be renamed twice');
  assert.notEqual(new FakeFile('quarterly-review.PNG').name, masked);
  assert.equal(new FakeFile('README').name.includes('.'), false);
  assert.equal(runtime.diagnostics().installed.AnonymiseFileNames, true);
  runtime.configure({ plugins: { AnonymiseFileNames: { enabled: false } } });
  assert.equal(file.name, 'quarterly-review.PNG');
});

// --- shared DOM, text and style hubs -------------------------------------------

const { createWorld } = require('./fake-dom');

// Descriptor setups are serialized, so a test collector has to live on the page
// world rather than in this file's scope.
function domEnvironment(plugins, extra = {}) {
  const world = createWorld(extra);
  const env = environment(plugins, world);
  return { env, doc: world.document, runtime: env.world.__slickEarly };
}

test('Censorship masks matched terms through the shared text pass and restores them on disable', () => {
  const censorship = require('../../runtime/plugins/censorship');
  const { doc, runtime } = domEnvironment([censorship]);
  const message = doc.createElement('div');
  const text = doc.createTextNode('I need a job in Ba Sing Se');
  message.append(text);
  doc.body.append(message);
  runtime.configure({ plugins: { Censorship: { enabled: true, terms: 'job, ba sing se', style: 'stars' } } });
  assert.equal(text.nodeValue, 'I need a *** in ** **** **');
  // Re-running over our own output must reproduce it rather than mask the mask.
  runtime.configure({ plugins: { Censorship: { enabled: true, terms: 'job, ba sing se', style: 'stars' } } });
  assert.equal(text.nodeValue, 'I need a *** in ** **** **');
  runtime.configure({ plugins: { Censorship: { enabled: true, terms: 'job', style: 'custom', replacement: 'uwu' } } });
  assert.equal(text.nodeValue, 'I need a uwu in Ba Sing Se');
  runtime.configure({
    plugins: {
      Censorship: { enabled: true, terms: 'job', style: 'stars', keepFirstLetter: true, keepLastLetter: true },
    },
  });
  assert.equal(text.nodeValue, 'I need a j*b in Ba Sing Se');
  runtime.configure({ plugins: { Censorship: { enabled: false } } });
  assert.equal(text.nodeValue, 'I need a job in Ba Sing Se');
  assert.deepEqual(
    Array.from(runtime.diagnostics().errors, (error) => error.message),
    [],
  );
});

test('the text pass covers newly inserted nodes and never touches drafts or code blocks', async () => {
  const censorship = require('../../runtime/plugins/censorship');
  const { doc, runtime } = domEnvironment([censorship]);
  runtime.configure({ plugins: { Censorship: { enabled: true, terms: 'job' } } });
  const message = doc.createElement('div');
  const text = doc.createTextNode('a job appears');
  message.append(text);
  doc.body.append(message);
  await Promise.resolve();
  assert.equal(text.nodeValue, 'a *** appears');
  const draft = doc.createElement('div');
  draft.setAttribute('contenteditable', 'true');
  const typing = doc.createTextNode('my job draft');
  draft.append(typing);
  const code = doc.createElement('code');
  const snippet = doc.createTextNode('job()');
  code.append(snippet);
  doc.body.append(draft, code);
  await Promise.resolve();
  assert.equal(typing.nodeValue, 'my job draft', 'a composer draft must never be rewritten');
  assert.equal(snippet.nodeValue, 'job()', 'code spans are skipped');
});

test('a throwing text transform is blamed on its own plugin and the others still run', () => {
  const censorship = require('../../runtime/plugins/censorship');
  const broken = {
    id: 'BrokenText',
    defaultEnabled: true,
    setup: function setup(api) {
      api.text(() => {
        throw new Error('transform exploded');
      });
    },
  };
  const { doc, runtime } = domEnvironment([broken, censorship]);
  const holder = doc.createElement('div');
  const text = doc.createTextNode('a job here');
  holder.append(text);
  doc.body.append(holder);
  runtime.configure({ plugins: { Censorship: { enabled: true, terms: 'job' } } });
  assert.equal(text.nodeValue, 'a *** here');
  assert.deepEqual(Array.from(new Set(Array.from(runtime.diagnostics().errors, (error) => error.capability))), [
    'BrokenText',
  ]);
});

test('style handles create one managed element per plugin and clear it when disabled', () => {
  const customFonts = require('../../runtime/plugins/custom-fonts');
  const { doc, runtime } = domEnvironment([customFonts]);
  runtime.configure({ plugins: { CustomFonts: { enabled: true, fontFamily: 'Comic Sans MS' } } });
  const style = doc.getElementById('slick-early-fonts');
  assert.ok(style, 'the style element is created once the document exists');
  assert.match(style.textContent, /"Comic Sans MS"/);
  assert.equal(runtime.diagnostics().capabilities.style, true);
  runtime.configure({ plugins: { CustomFonts: { enabled: false, fontFamily: 'Comic Sans MS' } } });
  assert.equal(doc.getElementById('slick-early-fonts').textContent, '');
  assert.equal(doc.documentElement.querySelectorAll('style').length, 1, 'redeploys reuse the same element');
});

test('one observer serves every plugin, and element hooks stop while their plugin is off', async () => {
  const seen = [];
  const watcher = {
    id: 'Watcher',
    defaultEnabled: true,
    setup: function setup(api) {
      api.ready(() => api.dom.elements('.c-message', (element) => globalThis.__seen.push(element.id)));
    },
  };
  const { doc, runtime } = domEnvironment([watcher], { __seen: seen });
  assert.equal(doc.observers.size, 1);
  const first = doc.createElement('div');
  first.id = 'm1';
  first.setAttribute('class', 'c-message');
  doc.body.append(first);
  await Promise.resolve();
  assert.deepEqual(seen, ['m1']);
  runtime.configure({ plugins: { Watcher: { enabled: false } } });
  const second = doc.createElement('div');
  second.id = 'm2';
  second.setAttribute('class', 'c-message');
  doc.body.append(second);
  await Promise.resolve();
  assert.deepEqual(seen, ['m1']);
  assert.equal(doc.observers.size, 1, 'disabling a plugin must not add or drop observers');
});

test('fiber walk climbs memoized props and records the capability', () => {
  const plugin = {
    id: 'FiberProbe',
    defaultEnabled: true,
    setup: function setup(api) {
      globalThis.__fiberApi = api.fiber;
      api.installed(true);
    },
  };
  const { env, doc, runtime } = domEnvironment([plugin]);
  const row = doc.createElement('div');
  row.__reactFiber$test = {
    memoizedProps: { name: 'thumbsup', count: 3, users: ['U1234567'] },
    pendingProps: {},
    return: { memoizedProps: { ignored: true }, pendingProps: {}, return: null },
  };
  const users = env.world.__fiberApi.walk(row, (memo) => (Array.isArray(memo?.users) ? memo.users : undefined));
  assert.deepEqual(users, ['U1234567']);
  assert.equal(!!env.world.__fiberApi.closest(row, (memo) => memo?.count === 3), true);
  assert.equal(runtime.diagnostics().capabilities.fiber, true);
});

test('color and file settings are coerced', () => {
  const plugin = {
    id: 'Paint',
    defaultEnabled: true,
    settings: {
      tint: { type: 'color', default: '#ffffff' },
      font: { type: 'file', default: '' },
    },
    setup: function setup() {},
  };
  const env = environment([plugin]);
  const runtime = env.world.__slickEarly;
  runtime.configure({ plugins: { Paint: { enabled: true, tint: '#e01e5a', font: '~/Fonts/x.ttf', bogus: 1 } } });
  assert.equal(runtime.diagnostics().active.Paint, true);
  runtime.configure({ plugins: { Paint: { enabled: true, tint: 'red', font: 12 } } });
  // Invalid values fall back to schema defaults; activation is independent.
  assert.equal(runtime.diagnostics().active.Paint, true);
});

test('embedded renderers serialize as real functions, wait until enabled, and clear CSS on disable', () => {
  const { embed } = require('../../runtime/embed');
  const plugin = embed({
    id: 'Sample',
    description: 'sample',
    settings: { flag: { type: 'boolean', default: true } },
    css: '.slick-sample { color: red }',
    renderer: '(function(){ window.__slickSampleRan = true; })();',
  });
  const source = bundle.source([plugin]);
  assert.match(source, /window\.__slickSampleRan/);
  assert.match(plugin.setup.toString(), /^function/);
  const { doc, runtime, env } = domEnvironment([plugin]);
  assert.equal(env.world.__slickSampleRan, undefined, 'disabled embed plugins do not run their renderer');
  runtime.configure({ plugins: { Sample: { enabled: true, flag: true } } });
  assert.equal(env.world.__slickSampleRan, true);
  assert.match(doc.getElementById('slick-early-sample').textContent, /slick-sample/);
  assert.equal(runtime.diagnostics().installed.Sample, true);
  runtime.configure({ plugins: { Sample: { enabled: false } } });
  assert.equal(doc.getElementById('slick-early-sample').textContent, '');
});

test('embedded CustomSlackbot CSS follows settings without a page renderer', () => {
  const plugin = require('../../runtime/plugins/custom-slackbot');
  const { doc, runtime } = domEnvironment([plugin]);
  runtime.configure({
    plugins: { CustomSlackbot: { enabled: true, name: 'Hackbot', url: '', badge: true } },
  });
  const css = doc.getElementById('slick-early-custom-slackbot').textContent;
  assert.match(css, /Hackbot/);
  assert.match(css, /custom_response_info_badge/);
  runtime.configure({ plugins: { CustomSlackbot: { enabled: false } } });
  assert.equal(doc.getElementById('slick-early-custom-slackbot').textContent, '');
});

test('embedded NotShitMarkdown rewrites outgoing markdown once enabled', async () => {
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype.open = function open() {};
  XMLHttpRequest.prototype.send = function send() {};
  const calls = [];
  const plugin = require('../../runtime/plugins/not-shit-markdown');
  const { env, runtime } = domEnvironment([plugin], {
    fetch(input, init) {
      calls.push({ input, body: init && init.body });
      return Promise.resolve({ status: 200 });
    },
    XMLHttpRequest,
    FormData: globalThis.FormData,
    URLSearchParams: globalThis.URLSearchParams,
    console: { log() {}, error() {} },
  });
  await env.world.fetch('https://app.slack.com/api/chat.postMessage', {
    method: 'POST',
    body: JSON.stringify({ text: 'say **hi** please' }),
  });
  assert.equal(JSON.parse(calls[0].body).text, 'say **hi** please', 'disabled plugin must not rewrite');
  runtime.configure({ plugins: { NotShitMarkdown: { enabled: true } } });
  await env.world.fetch('https://app.slack.com/api/chat.postMessage', {
    method: 'POST',
    body: JSON.stringify({ text: 'say **hi** please' }),
  });
  assert.equal(JSON.parse(calls[1].body).text, 'say *hi* please');
  assert.equal(runtime.diagnostics().installed.NotShitMarkdown, true);
});
