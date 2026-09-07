'use strict';

// Serialized into a static bundle by scripts/early/build.js. No runtime evaluation.
//
// Descriptors are plain objects: { id, description, defaultEnabled, settings, assets, probe, setup }.
// `setup` is serialized with Function.prototype.toString, so it must be self
// contained: module scope is not available to it in the page.
module.exports = function installEarly(descriptors) {
  if (globalThis.__slickEarly) return;
  const started = performance.now();
  const listeners = new Set();
  const factories = new WeakMap();
  const arrays = new WeakSet();
  const exportHooks = [];
  const components = new Map();
  const creatorCaches = new WeakMap();
  const stores = new Set();
  const errors = [];
  const stats = {
    modules: 0,
    chunks: 0,
    react: 0,
    stores: 0,
    componentHits: {},
    counters: {},
    installed: {},
    capabilities: {},
    hookMs: 0,
  };
  const plugins = [];
  const defaults = new Map();
  let config;
  let version = 0;
  let componentAPI;
  const fail = (capability, error) => {
    if (errors.length < 40) errors.push({ capability, message: String(error?.message || error).slice(0, 160) });
  };
  const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor.setup !== 'function' || !descriptor.id) continue;
    plugins.push(descriptor);
    const values = {};
    for (const [name, schema] of Object.entries(descriptor.settings || {})) values[name] = schema.default;
    defaults.set(descriptor, values);
  }

  // `enabled` is reserved on every plugin's settings object for activation.
  function coerceSetting(schema, value) {
    if (value === undefined) return schema.default;
    try {
      if (typeof schema.coerce === 'function') {
        const coerced = schema.coerce(value);
        return coerced === undefined ? schema.default : coerced;
      }
      const type = schema.type || 'text';
      if (type === 'boolean') return value === true;
      if (type === 'number') {
        const number = Number(value);
        if (!Number.isFinite(number)) return schema.default;
        return Math.min(Math.max(number, schema.min ?? -Infinity), schema.max ?? Infinity);
      }
      if (type === 'select')
        return (schema.options || []).some((option) => option.value === value) ? value : schema.default;
      if (type === 'names') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return schema.default;
        const names = {};
        let count = 0;
        for (const [id, name] of Object.entries(value)) {
          if (count >= 2000) break;
          if (!/^[UW][A-Z0-9]+$/.test(id) || typeof name !== 'string' || !name || name.length > 100) continue;
          names[id] = name;
          count++;
        }
        return names;
      }
      if (type === 'color')
        return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : schema.default;
      if (type === 'file') return typeof value === 'string' ? value.slice(0, schema.maxLength || 4000) : schema.default;
      return typeof value === 'string' ? value.slice(0, schema.maxLength || 4000) : schema.default;
    } catch (error) {
      fail('settings', error);
      return schema.default;
    }
  }

  function normalize(value) {
    const incoming = { ...(value.plugins && typeof value.plugins === 'object' ? value.plugins : {}) };
    // Accept the original two-plugin prototype shape.
    if (value.nicknames !== undefined) incoming.Nicknames = { ...incoming.Nicknames, names: value.nicknames };
    if (value.slim !== undefined) incoming.SlimMessageBox = { ...value.slim, ...incoming.SlimMessageBox };
    const resolved = {};
    for (const plugin of plugins) {
      const entry = incoming[plugin.id];
      const settings = { ...defaults.get(plugin) };
      let active = plugin.defaultEnabled === true;
      if (entry && typeof entry === 'object') {
        active = entry.enabled !== false;
        for (const [name, schema] of Object.entries(plugin.settings || {}))
          if (Object.hasOwn(entry, name)) settings[name] = coerceSetting(schema, entry[name]);
      }
      settings.enabled = active;
      resolved[plugin.id] = settings;
    }
    return { enabled: value.enabled !== false, plugins: resolved };
  }
  config = normalize({});
  const activeFor = (plugin) => config.enabled && config.plugins[plugin.id]?.enabled === true;

  function configure(value) {
    if (!value || typeof value !== 'object') return;
    config = normalize(value);
    version++;
    // A synchronous render can unsubscribe and resubscribe while we notify.
    const subscribers = [...listeners];
    for (const fn of subscribers) {
      try {
        fn();
      } catch (error) {
        fail('settings', error);
      }
    }
    for (const store of stores) {
      try {
        store.dispatch({ type: '@@slick/LOCAL_SETTINGS' });
      } catch (error) {
        fail('store refresh', error);
      }
    }
  }

  // --- shared document lifecycle -------------------------------------------------
  const readyHooks = [];
  let documentReady = false;
  const hasDocument = typeof document !== 'undefined';
  function runReady() {
    if (documentReady || !hasDocument || !document.documentElement) return;
    documentReady = true;
    flushStyles();
    ensureObserver();
    for (const hook of readyHooks) {
      try {
        hook.fn();
      } catch (error) {
        fail(hook.plugin.id, error);
      }
    }
    scan();
  }
  function onReady(plugin, fn) {
    readyHooks.push({ plugin, fn });
    if (!documentReady) return;
    try {
      fn();
    } catch (error) {
      fail(plugin.id, error);
    }
  }

  // --- shared styles -------------------------------------------------------------
  const styles = new Map();
  function flushStyle(id, entry) {
    if (!hasDocument || !document.documentElement) return;
    if (!entry.element) {
      entry.element = document.getElementById(id) || document.createElement('style');
      entry.element.id = id;
    }
    if (!entry.element.isConnected) (document.head || document.documentElement).append(entry.element);
    if (entry.element.textContent !== entry.css) entry.element.textContent = entry.css;
    stats.capabilities.style = true;
  }
  function flushStyles() {
    for (const [id, entry] of styles) {
      try {
        flushStyle(id, entry);
      } catch (error) {
        fail(entry.plugin.id, error);
      }
    }
  }
  function styleHandle(plugin, id) {
    const styleId = id || `slick-early-${plugin.id}`;
    let entry = styles.get(styleId);
    if (!entry) {
      entry = { plugin, css: '', element: null };
      styles.set(styleId, entry);
    }
    return {
      id: styleId,
      set(css) {
        entry.css = typeof css === 'string' ? css : '';
        try {
          flushStyle(styleId, entry);
        } catch (error) {
          fail(plugin.id, error);
        }
      },
    };
  }

  // --- shared DOM hub ------------------------------------------------------------
  // One MutationObserver for every plugin: repeated independent observers over
  // Slack's tree are the main cost of the legacy renderer plugins.
  const domHooks = [];
  let observer = null;
  let observingCharacterData = false;
  // Hooks receive the added and removed nodes plus the mutation targets, so a
  // plugin can react to a removal without re-walking the whole document.
  function dispatch(added, removed, targets = []) {
    for (const hook of domHooks) {
      if (hook.plugin && !activeFor(hook.plugin)) continue;
      try {
        hook.fn(added, removed, targets);
      } catch (error) {
        fail(hook.plugin ? hook.plugin.id : 'dom', error);
      }
    }
  }
  function handleRecords(records) {
    const added = [];
    const removed = [];
    const targets = [];
    for (const record of records) {
      targets.push(record.target);
      if (record.type === 'characterData') added.push(record.target);
      else {
        for (const node of record.addedNodes) added.push(node);
        for (const node of record.removedNodes) removed.push(node);
      }
    }
    if (added.length || removed.length) dispatch(added, removed, targets);
  }
  function ensureObserver() {
    if (!hasDocument || !document.documentElement || !domHooks.length) return;
    const characterData = domHooks.some((hook) => hook.characterData);
    if (observer && observingCharacterData === characterData) return;
    observingCharacterData = characterData;
    observer ||= new MutationObserver(handleRecords);
    observer.disconnect();
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData });
    stats.capabilities.dom = true;
  }
  function scan() {
    if (!hasDocument || !document.documentElement || !domHooks.length) return;
    dispatch([document.documentElement], []);
  }
  function domApi(plugin) {
    return {
      roots(fn, options = {}) {
        const hook = { plugin, fn, characterData: options.characterData === true };
        domHooks.push(hook);
        ensureObserver();
        if (documentReady) {
          try {
            fn([document.documentElement], [], []);
          } catch (error) {
            fail(plugin.id, error);
          }
        }
        return () => {
          const index = domHooks.indexOf(hook);
          if (index !== -1) domHooks.splice(index, 1);
        };
      },
      elements(selector, onAdd, onRemove) {
        const visit = (nodes, callback) => {
          if (!callback) return;
          for (const node of nodes) {
            if (!node || node.nodeType !== 1) continue;
            if (node.matches(selector)) callback(node);
            for (const found of node.querySelectorAll(selector)) callback(found);
          }
        };
        return this.roots((added, removed) => {
          visit(added, onAdd);
          visit(removed, onRemove);
        });
      },
      rescan: scan,
    };
  }

  // --- shared text pass ----------------------------------------------------------
  const SKIP_TAGS = new Set([
    'SCRIPT',
    'STYLE',
    'TEXTAREA',
    'INPUT',
    'SELECT',
    'OPTION',
    'CODE',
    'PRE',
    'KBD',
    'SAMP',
    'NOSCRIPT',
    'IFRAME',
    'CANVAS',
    'SVG',
    'TITLE',
  ]);
  const SKIP_ANCESTORS = '[contenteditable="true"],#slick-panel-overlay,#slick-config-backdrop';
  const textHooks = [];
  const textOriginal = new WeakMap();
  const textApplied = new WeakMap();
  const textChanged = new Set();
  let textStarted = false;
  function restoreText(node) {
    if (!textOriginal.has(node)) return;
    node.nodeValue = textOriginal.get(node);
    textOriginal.delete(node);
    textApplied.delete(node);
    textChanged.delete(node);
  }
  function activeTextHooks() {
    return textHooks.filter((hook) => activeFor(hook.plugin));
  }
  function skipText(node) {
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName)) return true;
    return !!parent.closest?.(SKIP_ANCESTORS);
  }
  function applyText(node, hooks) {
    if (!node || node.nodeType !== 3) return;
    if (!hooks.length || skipText(node)) return restoreText(node);
    // Recover the pre-transform text: our own writes are recognised by the last
    // value we produced, so re-running over a transformed node converges.
    let original = textOriginal.get(node);
    if (original === undefined || node.nodeValue !== textApplied.get(node)) original = node.nodeValue || '';
    let next = original;
    for (const hook of hooks) {
      try {
        const result = hook.transform(next);
        if (typeof result === 'string') next = result;
      } catch (error) {
        fail(hook.plugin.id, error);
      }
    }
    if (next === original) return restoreText(node);
    textOriginal.set(node, original);
    textApplied.set(node, next);
    textChanged.add(node);
    if (node.nodeValue !== next) node.nodeValue = next;
    stats.capabilities.text = true;
  }
  function walkText(root, hooks) {
    if (!root) return;
    if (root.nodeType === 3) return applyText(root, hooks);
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.nodeType === 1 && SKIP_TAGS.has(root.tagName)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (skipText(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let node;
    while ((node = walker.nextNode())) applyText(node, hooks);
  }
  function pruneText() {
    for (const node of textChanged) {
      if (node.isConnected) continue;
      textOriginal.delete(node);
      textApplied.delete(node);
      textChanged.delete(node);
    }
  }
  function runText(roots) {
    const hooks = activeTextHooks();
    if (!hooks.length) {
      for (const node of Array.from(textChanged)) restoreText(node);
      return;
    }
    pruneText();
    for (const root of roots) walkText(root, hooks);
  }
  function registerText(plugin, transform) {
    const hook = { plugin, transform };
    textHooks.push(hook);
    if (!textStarted && hasDocument) {
      textStarted = true;
      domHooks.push({ plugin: null, fn: (added) => runText(added), characterData: true });
      ensureObserver();
      subscribe(() => runText([document.body || document.documentElement].filter(Boolean)));
    }
    return () => {
      const index = textHooks.indexOf(hook);
      if (index !== -1) textHooks.splice(index, 1);
      runText([document.body || document.documentElement].filter(Boolean));
    };
  }

  // --- shared network hooks ------------------------------------------------------
  // Installed before Slack's first script runs, which is the whole point of the
  // early runtime: the legacy renderer patches land after Slack captured fetch.
  const requestHooks = [];
  const socketHooks = [];
  let netInstalled = false;
  function makeRequest(url, method, body) {
    return {
      url: String(url ?? ''),
      method: String(method || 'GET').toUpperCase(),
      body,
      changed: false,
      blocked: false,
      setBody(next) {
        if (next === this.body) return;
        this.body = next;
        this.changed = true;
      },
      block() {
        this.blocked = true;
      },
    };
  }
  function runRequestHooks(request) {
    for (const hook of requestHooks) {
      if (!activeFor(hook.plugin)) continue;
      try {
        hook.fn(request);
      } catch (error) {
        fail(hook.plugin.id, error);
      }
      if (request.blocked) return request;
    }
    return request;
  }
  function blockedResponse() {
    // 204 is a null-body status: passing a body to the constructor throws.
    if (typeof Response === 'function') return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.reject(new TypeError('Failed to fetch'));
  }
  function installNet() {
    if (netInstalled) return stats.capabilities.net === true;
    netInstalled = true;
    let ok = false;
    try {
      const originalFetch = globalThis.fetch;
      if (typeof originalFetch === 'function') {
        globalThis.fetch = function fetch(input, init) {
          try {
            const url = typeof input === 'string' ? input : input?.url || String(input);
            const request = runRequestHooks(makeRequest(url, init?.method || input?.method, init?.body));
            if (request.blocked) return blockedResponse();
            if (request.changed) return originalFetch.call(this, input, { ...init, body: request.body });
          } catch (error) {
            fail('net', error);
          }
          return originalFetch.apply(this, arguments);
        };
        ok = true;
      }
      const XHR = globalThis.XMLHttpRequest;
      if (XHR?.prototype) {
        const originalOpen = XHR.prototype.open;
        const originalSend = XHR.prototype.send;
        XHR.prototype.open = function open(method, url) {
          this.__slickRequest = { method, url };
          return originalOpen.apply(this, arguments);
        };
        XHR.prototype.send = function send(body) {
          try {
            const meta = this.__slickRequest;
            if (meta) {
              const request = runRequestHooks(makeRequest(meta.url, meta.method, body));
              if (request.blocked) {
                // A blocked request looks like a transport failure, which is what
                // main-process URL blocking already produces for these endpoints.
                const target = this;
                setTimeout(() => {
                  try {
                    target.dispatchEvent(new Event('error'));
                    target.dispatchEvent(new Event('loadend'));
                  } catch {}
                }, 0);
                return;
              }
              if (request.changed) return originalSend.call(this, request.body);
            }
          } catch (error) {
            fail('net', error);
          }
          return originalSend.apply(this, arguments);
        };
        ok = true;
      }
      const navigatorRef = globalThis.navigator;
      if (navigatorRef && typeof navigatorRef.sendBeacon === 'function') {
        const originalBeacon = navigatorRef.sendBeacon;
        try {
          Object.defineProperty(navigatorRef, 'sendBeacon', {
            configurable: true,
            writable: true,
            value: function sendBeacon(url, data) {
              try {
                const request = runRequestHooks(makeRequest(url, 'POST', data));
                if (request.blocked) return true;
                if (request.changed) return originalBeacon.call(navigatorRef, url, request.body);
              } catch (error) {
                fail('net', error);
              }
              return originalBeacon.apply(navigatorRef, arguments);
            },
          });
        } catch (error) {
          fail('net', error);
        }
      }
      const WebSocketRef = globalThis.WebSocket;
      if (WebSocketRef?.prototype && typeof WebSocketRef.prototype.send === 'function') {
        const originalSocketSend = WebSocketRef.prototype.send;
        WebSocketRef.prototype.send = function send(data) {
          let payload = data;
          let url = '';
          for (const hook of socketHooks) {
            if (!activeFor(hook.plugin)) continue;
            try {
              // Reading `url` can throw on an unusual receiver; the hooks are
              // still useful without it.
              if (url === '') {
                try {
                  url = this.url;
                } catch {
                  url = null;
                }
              }
              const result = hook.fn(payload, url);
              if (result === null) return;
              if (result !== undefined) payload = result;
            } catch (error) {
              fail(hook.plugin.id, error);
            }
          }
          return originalSocketSend.call(this, payload);
        };
        ok = true;
      }
    } catch (error) {
      fail('net', error);
    }
    stats.capabilities.net = ok;
    return ok;
  }
  function netApi(plugin) {
    return {
      request(fn) {
        requestHooks.push({ plugin, fn });
        return installNet();
      },
      socket(fn) {
        socketHooks.push({ plugin, fn });
        return installNet();
      },
    };
  }

  const FIBER_PREFIXES = ['__reactFiber$', '__reactInternalInstance$'];
  function fiberOf(el) {
    if (!el || typeof el !== 'object') return null;
    const key = Object.keys(el).find((name) => FIBER_PREFIXES.some((prefix) => name.startsWith(prefix)));
    const fiber = key ? el[key] : null;
    if (fiber) stats.capabilities.fiber = true;
    return fiber || null;
  }
  function fiberWalk(el, visit, maxHops, onError) {
    if (typeof visit !== 'function') return undefined;
    let fiber = fiberOf(el);
    let hops = 0;
    const limit = Math.min(Math.max(Number(maxHops) || 40, 1), 80);
    while (fiber && hops < limit) {
      try {
        const result = visit(fiber.memoizedProps, fiber.pendingProps, fiber);
        if (result !== undefined) return result;
      } catch (error) {
        if (onError) onError(error);
        return undefined;
      }
      fiber = fiber.return;
      hops++;
    }
    return undefined;
  }
  function fiberApi(plugin) {
    const onError = (error) => fail(plugin.id, error);
    return {
      of: fiberOf,
      walk: (el, visit, maxHops) => fiberWalk(el, visit, maxHops, onError),
      closest(el, predicate, maxHops) {
        if (typeof predicate !== 'function') return null;
        return (
          fiberWalk(
            el,
            (memo, pending, fiber) => (predicate(memo, pending, fiber) ? fiber : undefined),
            maxHops,
            onError,
          ) || null
        );
      },
    };
  }

  function apiFor(plugin) {
    return {
      id: plugin.id,
      assets: plugin.assets || {},
      get settings() {
        return config.plugins[plugin.id];
      },
      get enabled() {
        return activeFor(plugin);
      },
      get version() {
        return version;
      },
      subscribe,
      fail: (error) => fail(plugin.id, error),
      installed(ok) {
        stats.installed[plugin.id] = ok !== false;
      },
      count(name, amount = 1) {
        const key = `${plugin.id}.${name}`;
        stats.counters[key] = (stats.counters[key] || 0) + amount;
      },
      onExports(fn) {
        exportHooks.push(fn);
      },
      component(name, transform) {
        const list = components.get(name) || [];
        list.push({ plugin, transform });
        components.set(name, list);
      },
      trackStore(store) {
        stores.add(store);
        stats.stores = stores.size;
      },
      style: (id) => styleHandle(plugin, id),
      dom: domApi(plugin),
      text: (transform) => registerText(plugin, transform),
      net: netApi(plugin),
      fiber: fiberApi(plugin),
      ready: (fn) => onReady(plugin, fn),
    };
  }
  for (const plugin of plugins) {
    try {
      plugin.setup(apiFor(plugin));
    } catch (error) {
      fail('plugin startup', error);
    }
  }

  function resolve(type, creator, base) {
    if (!type || (typeof type !== 'function' && typeof type !== 'object')) return type;
    let cache = creatorCaches.get(creator);
    if (!cache) {
      cache = new WeakMap();
      creatorCaches.set(creator, cache);
    }
    if (cache.has(type)) return cache.get(type);
    const name = type.displayName || type.type?.displayName || type.render?.displayName || type.name;
    const transforms = components.get(name);
    if (!transforms) {
      cache.set(type, type);
      return type;
    }
    // Class subscriptions use the renderer's instance updater, not a global hook
    // dispatcher. JSX runtimes need not import React (React 19 production does not).
    class SlickComponent extends base.Component {
      componentDidMount() {
        this.unsubscribe = subscribe(() => this.forceUpdate());
        // Settings may have changed between render and commit.
        if (this.renderedVersion !== version) this.forceUpdate();
      }
      componentWillUnmount() {
        this.unsubscribe();
      }
      render() {
        this.renderedVersion = version;
        const { originalProps, forwardedRef } = this.props;
        let next = originalProps;
        for (const entry of transforms) {
          if (!activeFor(entry.plugin)) continue;
          try {
            next = entry.transform(next) ?? next;
          } catch (error) {
            fail(entry.plugin.id, error);
          }
        }
        stats.componentHits[name] = (stats.componentHits[name] || 0) + 1;
        return creator(type, forwardedRef == null ? next : { ...next, ref: forwardedRef });
      }
    }
    SlickComponent.displayName = `SlickSubscription(${name})`;
    const wrapper = base.forwardRef((props, ref) =>
      creator(SlickComponent, { originalProps: props, forwardedRef: ref }),
    );
    wrapper.displayName = `Slick(${name})`;
    cache.set(type, wrapper);
    cache.set(wrapper, wrapper);
    return wrapper;
  }
  const wrappedCreators = new WeakSet();
  const seenReact = new WeakSet();
  function patchReact(exp) {
    if (!exp || typeof exp !== 'object') return exp;
    const isReact =
      typeof exp.createElement === 'function' &&
      typeof exp.Component === 'function' &&
      typeof exp.forwardRef === 'function';
    if (isReact && !seenReact.has(exp)) {
      seenReact.add(exp);
      componentAPI ||= exp;
      stats.react++;
    }
    const keys = isReact
      ? ['createElement']
      : typeof exp.jsx === 'function' && typeof exp.jsxs === 'function'
        ? ['jsx', 'jsxs']
        : [];
    for (const key of keys) {
      const original = exp[key];
      if (wrappedCreators.has(original)) continue;
      function create(type, ...args) {
        const base = isReact ? exp : componentAPI;
        return original.call(this, base ? resolve(type, original, base) : type, ...args);
      }
      const desc = Object.getOwnPropertyDescriptor(exp, key);
      if (desc?.writable || desc?.configurable) {
        Object.defineProperty(exp, key, { value: create, writable: true, configurable: true, enumerable: true });
        wrappedCreators.add(create);
      }
    }
    return exp;
  }
  function wrap(factory) {
    if (factories.has(factory)) return factories.get(factory);
    function wrapped(module, exports, require) {
      // Preserve synchronous module execution, this, return value, and thrown errors.
      const result = factory.call(this, module, exports, require);
      const begin = performance.now();
      stats.modules++;
      try {
        let exp = patchReact(module.exports);
        for (const hook of exportHooks) {
          try {
            exp = hook(exp) ?? exp;
          } catch (error) {
            fail('exports', error);
          }
        }
        module.exports = exp;
      } catch (error) {
        fail('module', error);
      }
      stats.hookMs += performance.now() - begin;
      return result;
    }
    wrapped.toString = () => Function.prototype.toString.call(factory);
    factories.set(factory, wrapped);
    factories.set(wrapped, wrapped);
    return wrapped;
  }
  function prepare(chunk) {
    if (!Array.isArray(chunk) || !chunk[1] || typeof chunk[1] !== 'object') return;
    stats.chunks++;
    for (const id of Object.keys(chunk[1])) if (typeof chunk[1][id] === 'function') chunk[1][id] = wrap(chunk[1][id]);
  }
  function hookArray(array) {
    if (!Array.isArray(array) || arrays.has(array)) return;
    arrays.add(array);
    for (const chunk of array) prepare(chunk);
    const wrapPush = (original) =>
      function push(...chunks) {
        for (const chunk of chunks) prepare(chunk);
        return original.apply(this, chunks);
      };
    let push = wrapPush(array.push);
    Object.defineProperty(array, 'push', {
      configurable: true,
      get: () => push,
      set(next) {
        if (next !== push) push = wrapPush(next);
      },
    });
  }
  const globals = ['webpackChunkwebapp', 'rspackChunkwebapp'];
  const late = globals.some((name) => Array.isArray(globalThis[name]));
  for (const name of globals) {
    let value = globalThis[name];
    try {
      hookArray(value);
      Object.defineProperty(globalThis, name, {
        configurable: true,
        enumerable: true,
        get: () => value,
        set(next) {
          value = next;
          hookArray(next);
        },
      });
    } catch (error) {
      fail(name, error);
    }
  }
  if (hasDocument) {
    document.addEventListener('DOMContentLoaded', runReady, { once: true });
    document.addEventListener('readystatechange', runReady);
    window.addEventListener('pageshow', () => {
      ensureObserver();
      scan();
    });
    window.addEventListener('pagehide', () => {
      observer?.disconnect();
      observer = null;
      observingCharacterData = false;
    });
    runReady();
  }
  const installMs = performance.now() - started;
  window.addEventListener('message', (event) => {
    if (event.source === window && event.origin === location.origin && event.data?.type === 'slick-early-settings')
      configure(event.data.config);
  });
  globalThis.__slickEarly = {
    configure,
    plugins: plugins.map(({ id, defaultEnabled, probe }) => ({ id, defaultEnabled: defaultEnabled === true, probe })),
    diagnostics: () => ({
      ...stats,
      componentHits: { ...stats.componentHits },
      counters: { ...stats.counters },
      installed: { ...stats.installed },
      capabilities: { ...stats.capabilities },
      active: Object.fromEntries(plugins.map((plugin) => [plugin.id, activeFor(plugin)])),
      errors: [...errors],
      late,
      installedAt: started,
      installMs,
      enabled: config.enabled,
    }),
  };
};
