(function () {
  'use strict';
  if (window.__slickShowRealUser) return;

  const RELAY_BOTS = {
    B08G06U6SJG: (msg) => msg?.metadata?.event_payload?.source_user_id,
    B0BJDMND6HX: (msg) => msg?.metadata?.event_payload?.source_user_id,
    B0BEYA2UKPZ: (msg) => msg?.metadata?.event_payload?.source_user_id,
  };
  const RELAY_EXTRACT = (msg) => msg?.metadata?.event_payload?.source_user_id;
  const ID_RE = /^[UW][A-Z0-9]+$/;
  const SERVICE_RE = /\/services\/(B[A-Z0-9]+)/;
  const KEY = 'slick:show-real-user';
  const TTL = 30 * 24 * 60 * 60 * 1000;

  const PATCH_NAMES = new Set([
    'MessageWrapper',
    'ThreadRootGeneric',
    'ActivityItem',
    'MessageListItem',
    'MessageActionsMenu',
    'MessageActionsOverflowMenu',
  ]);
  let nameCache = new WeakMap();
  const msgCache = new WeakMap();
  const plainMsgs = new WeakSet();

  const senders = load();
  const failed = new Set();
  const inflight = new Set();
  const memberCache = new Map();
  let pendingForwards = 0;
  let lookupGeneration = 0;
  let lastForwardScan = -1;
  let refreshTimer = null;

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      const now = Date.now();
      const out = {};
      for (const [k, v] of Object.entries(raw || {})) {
        if (v && typeof v.ts === 'number' && now - v.ts < TTL) out[k] = v.value;
      }
      return out;
    } catch {
      return {};
    }
  }
  let saveTimer = null;
  const dirtyKeys = new Set();
  function sc(key) {
    if (key) dirtyKeys.add(key);
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        if (dirtyKeys.size) {
          const now = Date.now();
          let data = {};
          try {
            data = JSON.parse(localStorage.getItem(KEY)) || {};
          } catch {}
          for (const k of dirtyKeys) {
            if (k in senders) data[k] = { value: senders[k], ts: now };
            else delete data[k];
          }
          dirtyKeys.clear();
          const keys = Object.keys(data);
          if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 5000)) delete data[k];
          localStorage.setItem(KEY, JSON.stringify(data));
        }
      } catch {}
    }, 500);
  }

  let cachedToken = null;
  let cachedTokenAt = 0;
  let cachedTokenRoute = '';
  function token() {
    const now = Date.now();
    const routeTeamId = (location.pathname.match(/\/client\/([A-Z0-9]+)/) || [])[1] || '';
    if (cachedToken !== null && cachedTokenRoute === routeTeamId && now - cachedTokenAt < 60 * 1000) return cachedToken;
    try {
      const conf = JSON.parse(localStorage.getItem('localConfig_v2'));
      const teams = (conf && conf.teams) || {};
      const team = teams[routeTeamId] || Object.values(teams).find((t) => t && t.token);
      cachedToken = (team && team.token) || null;
      cachedTokenAt = now;
      cachedTokenRoute = routeTeamId;
      return cachedToken;
    } catch {
      return null;
    }
  }

  async function history(channel, ts) {
    const tok = token();
    if (!tok) return null;
    const body = new FormData();
    body.append('token', tok);
    body.append('channel', channel);
    body.append('oldest', ts);
    body.append('latest', ts);
    body.append('inclusive', 'true');
    body.append('limit', '1');
    body.append('include_all_metadata', 'true');
    try {
      const res = await fetch('/api/conversations.history', { method: 'POST', body });
      const data = await res.json().catch(() => null);
      return data?.ok ? (data.messages?.[0] ?? null) : null;
    } catch {
      return null;
    }
  }

  async function memberInfo(user) {
    const tok = token();
    if (!tok) return null;
    const body = new FormData();
    body.append('token', tok);
    body.append('user', user);
    try {
      const res = await fetch('/api/users.info', { method: 'POST', body });
      const data = await res.json().catch(() => null);
      if (data?.ok && data.user) {
        const profile = data.user.profile || {};
        return {
          name: profile.display_name || profile.real_name || data.user.real_name || data.user.name,
          icon: profile.image_48,
        };
      }
    } catch {}
    return null;
  }

  let webpackRequire = null;
  let lastChunks = null;
  let fullyHooked = false;
  function getRequire() {
    const chunks = window.rspackChunkwebapp || window.webpackChunkwebapp;
    if (!chunks || !chunks.push) return null;
    if (chunks !== lastChunks) {
      webpackRequire = null;
      react = null;
      jsxRuntime = null;
      fullyHooked = false;
      nameCache = new WeakMap();
      lastChunks = chunks;
    }
    if (!webpackRequire) {
      chunks.push([['slick-show-real-user-' + Date.now()], {}, (require) => (webpackRequire = require)]);
    }
    return webpackRequire;
  }
  const findModule = (require, needle, fallbackId) =>
    require(Object.keys(require.m || {}).find((k) => String(require.m[k]).includes(needle)) || fallbackId);

  let getStores = null;
  let storeTried = false;
  let cachedFiberStore = null;
  let cachedFiberRoute = null;
  function findStore() {
    if (!storeTried) {
      storeTried = true;
      const r = getRequire();
      if (r) {
        try {
          const mod = findModule(r, 'getStoreInstanceMap', 0x1856bb20b);
          getStores =
            Object.values(mod || {}).find((v) => typeof v === 'function' && v.name === 'getStoreInstanceMap') || null;
        } catch {}
      }
    }
    if (getStores) {
      try {
        const stores = getStores() || {};
        const routeTeamId = (location.pathname.match(/\/client\/([A-Z0-9]+)/) || [])[1];
        let store = routeTeamId && stores[routeTeamId];
        if (!store) {
          const list = Object.values(stores).filter(
            (s) => typeof s?.getState === 'function' && typeof s?.dispatch === 'function',
          );
          store =
            list.find((s) => s.getState()?.selfTeamIds?.teamId === routeTeamId) || (list.length === 1 ? list[0] : null);
        }
        if (store) return store;
      } catch {}
    }
    const route = location.pathname;
    if (cachedFiberStore && cachedFiberRoute === route) return cachedFiberStore;
    const found = findStoreByFiber();
    if (found) {
      cachedFiberStore = found;
      cachedFiberRoute = route;
    }
    return found;
  }
  function fiberOf(el) {
    const k = Object.keys(el).find(
      (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'),
    );
    return k ? el[k] : null;
  }
  const COMPOSER_SELECTOR = [
    '[data-qa="texty_input"][contenteditable="true"]',
    '[data-qa="message_input"][contenteditable="true"]',
    '[data-qa="message-input"][contenteditable="true"]',
    '.c-wysiwyg_container [contenteditable="true"][role="textbox"]',
    '.p-message_input [contenteditable="true"][role="textbox"]',
    '.p-threads_footer [contenteditable="true"][role="textbox"]',
  ].join(',');
  function storeFromFiber(fiber) {
    for (let current = fiber; current; current = current.return) {
      const value = current.memoizedProps?.value;
      const viaValue = value?.store ?? value;
      if (viaValue && typeof viaValue.getState === 'function' && typeof viaValue.dispatch === 'function') {
        return viaValue;
      }
      for (const props of [current.memoizedProps, current.pendingProps, current.stateNode?.props]) {
        if (props?.store && typeof props.store.getState === 'function' && typeof props.store.dispatch === 'function') {
          return props.store;
        }
      }
    }
    return null;
  }
  function findStoreByFiber() {
    for (const root of document.querySelectorAll(
      '.p-client_container, [data-qa="texty_input"], .p-message_input, .p-threads_footer',
    )) {
      const el = root?.firstElementChild || root;
      const fiber = fiberOf(el);
      const store = fiber ? storeFromFiber(fiber) : null;
      if (store) return store;
    }
    for (const composer of document.querySelectorAll(COMPOSER_SELECTOR) || []) {
      const store = storeFromFiber(fiberOf(composer));
      if (store) return store;
    }
    return null;
  }
  function storeState() {
    return findStore()?.getState() ?? null;
  }

  const wrappedStores = new WeakSet();
  let patchedVersion = 0;
  function wrapGetState(store) {
    if (!store || typeof store.getState !== 'function' || wrappedStores.has(store)) return;
    wrappedStores.add(store);
    const realGetState = store.getState.bind(store);
    let cachedRaw;
    let cachedVersion = -1;
    let cachedOut;
    store.getState = () => {
      const raw = realGetState();
      if (raw === cachedRaw && cachedVersion === patchedVersion && cachedOut !== undefined) return cachedOut;
      const state = raw;
      const slice = state?.messages;
      if (!slice || typeof slice !== 'object' || Object.keys(slice).length === 0) {
        cachedRaw = raw;
        cachedVersion = patchedVersion;
        cachedOut = state;
        return state;
      }
      cachedRaw = raw;
      cachedVersion = patchedVersion;
      cachedOut = {
        ...state,
        messages: mapEntries(slice, (channelId, bucket) =>
          bucket && typeof bucket === 'object'
            ? mapEntries(bucket, (ts, msg) => fixed(msg, channelId, ts) ?? msg)
            : bucket,
        ),
      };
      return cachedOut;
    };
    nudgeStore();
  }

  function hookCreateStore() {
    const internals = window.__slickInternals;
    if (!internals?.modules?.patchModuleExports) return;
    internals.modules.patchModuleExports((exports) => {
      if (!exports || typeof exports !== 'object') return;
      for (const key of Object.keys(exports)) {
        let value;
        try {
          value = exports[key];
        } catch {
          continue;
        }
        if (typeof value !== 'function' || value.name !== 'createStore') continue;
        const original = value;
        const hooked = (...args) => {
          const store = original(...args);
          try {
            wrapGetState(store);
          } catch {}
          return store;
        };
        const descriptors = Object.getOwnPropertyDescriptors(exports);
        descriptors[key] = { ...descriptors[key], value: hooked };
        return Object.create(Object.getPrototypeOf(exports), descriptors);
      }
    });
  }

  const MESSAGE_SELECTOR_KEYS = ['NC', 'h8', 'Ld', 'oJ', 'u0'];
  let messageSelectorsPatched = false;
  function patchMessageSelectors() {
    if (messageSelectorsPatched) return;
    const r = getRequire();
    if (!r) return;
    const cache = r.c || {};
    const entry = cache['MPi0'];
    if (!entry?.exports || typeof entry.exports !== 'object') return;
    messageSelectorsPatched = true;
    const patched = { ...entry.exports };
    for (const key of MESSAGE_SELECTOR_KEYS) {
      const orig = patched[key];
      if (typeof orig !== 'function') continue;
      patched[key] = function (...args) {
        const out = orig.apply(this, args);
        if (!out || typeof out !== 'object') return out;
        const msgs = out.messages;
        if (Array.isArray(msgs)) {
          let changed = -1;
          for (let i = 0; i < msgs.length; i++) {
            const next = fixed(msgs[i], msgs[i]?.channel, msgs[i]?.ts);
            if (next && next !== msgs[i]) {
              if (changed < 0) changed = i;
            }
          }
          if (changed < 0) return out;
          const fixedMsgs = msgs.slice();
          for (let i = changed; i < fixedMsgs.length; i++) {
            const next = fixed(fixedMsgs[i], fixedMsgs[i]?.channel, fixedMsgs[i]?.ts);
            if (next) fixedMsgs[i] = next;
          }
          return { ...out, messages: fixedMsgs };
        }
        const next = fixed(out, out?.channel, out?.ts);
        return next && next !== out ? next : out;
      };
    }
    entry.exports = patched;
  }

  let nudgeTimer = null;
  function nudgeStore() {
    if (nudgeTimer) return;
    nudgeTimer = setTimeout(() => {
      nudgeTimer = null;
      const store = findStore();
      if (!store) return;
      patchedVersion++;
      try {
        store.dispatch({ type: '@@slick/PATCH_STATE' });
      } catch {}
      void finishForwards().then(() => {
        patchedVersion++;
        try {
          store.dispatch({ type: '@@slick/PATCH_STATE' });
        } catch {}
      });
    }, 16);
  }

  function mapEntries(object, mapEntry) {
    const cache = new Map();
    const run = (key, value) => {
      if (typeof key !== 'string') return value;
      const hit = cache.get(key);
      if (hit && hit.input === value) return hit.output;
      const output = mapEntry(key, value);
      cache.set(key, { input: value, output });
      return output;
    };
    return new Proxy(object, {
      get: (target, key) => run(key, target[key]),
      getOwnPropertyDescriptor: (target, key) => {
        const desc = Object.getOwnPropertyDescriptor(target, key);
        if (!desc || !('value' in desc) || desc.configurable === false) return desc;
        return { ...desc, value: run(key, desc.value) };
      },
    });
  }

  function isUserObj(v) {
    return !!(v && typeof v === 'object' && typeof v.id === 'string' && v.profile && typeof v.profile === 'object');
  }
  function idKeys(v) {
    const own = Object.keys(v);
    if (own.length) return own;
    const proto = Object.getPrototypeOf(v);
    return proto && proto !== Object.prototype ? Object.keys(proto) : [];
  }
  function isMemberMap(v) {
    if (!v || typeof v !== 'object') return false;
    const keys = idKeys(v).slice(0, 5);
    return keys.length > 0 && keys.every((k) => /^[UWB][A-Z0-9]{6,}$/.test(k)) && isUserObj(v[keys[0]]);
  }
  let membersPath = null;
  let nextScan = 0;
  function profileFromStore(user) {
    try {
      const state = storeState();
      if (!state) return null;
      if (membersPath) {
        const hit = membersPath.reduce((obj, k) => (obj == null ? null : obj[k]), state);
        if (isMemberMap(hit)) return hit[user] ?? null;
        membersPath = null;
      }
      if (Date.now() < nextScan) return null;
      nextScan = Date.now() + 5000;
      for (const [k, v] of Object.entries(state)) {
        if (isMemberMap(v)) {
          membersPath = [k];
          return v[user] ?? null;
        }
      }
      for (const [k, v] of Object.entries(state)) {
        if (!v || typeof v !== 'object') continue;
        for (const [k2, v2] of Object.entries(v)) {
          if (isMemberMap(v2)) {
            membersPath = [k, k2];
            return v2[user] ?? null;
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }
  async function memberOf(user) {
    if (memberCache.has(user)) return memberCache.get(user);
    const fromStore = profileFromStore(user);
    const out = fromStore
      ? {
          name:
            fromStore.profile?.display_name || fromStore.profile?.real_name || fromStore.real_name || fromStore.name,
          icon: fromStore.profile?.image_48,
        }
      : await memberInfo(user);
    memberCache.set(user, out);
    return out;
  }

  function relayOf(msg) {
    if (!msg?.bot_id) return undefined;
    const known = RELAY_BOTS[msg.bot_id];
    if (known) return known;
    return msg.metadata?.event_type ? RELAY_EXTRACT : undefined;
  }
  function realId(value) {
    return typeof value === 'string' && ID_RE.test(value) ? value : undefined;
  }
  function asSentBy(msg, user) {
    const real = { ...msg, user };
    for (const key of ['bot_id', 'app_id', 'username', 'icons', 'bot_profile', 'display_as_bot', 'metadata'])
      delete real[key];
    if (real.subtype === 'bot_message') delete real.subtype;
    return real;
  }
  function profileLink(link, user) {
    try {
      return `${new URL(link ?? '').origin}/team/${user}`;
    } catch {
      return link;
    }
  }

  function senderOf(channel, ts) {
    const key = `${channel}:${ts}`;
    if (key in senders) return senders[key] ?? undefined;
    if (!failed.has(key) && !inflight.has(key)) {
      inflight.add(key);
      void doLookUp(key);
    }
    return undefined;
  }
  const MAX_LOOKUP_INFLIGHT = 6;
  let lookupSlots = MAX_LOOKUP_INFLIGHT;
  const lookupWaiters = [];
  async function doLookUp(key) {
    try {
      if (lookupSlots <= 0) await new Promise((r) => lookupWaiters.push(r));
      lookupSlots--;
      const [channel, ts] = key.split(':');
      const msg = await history(channel, ts);
      const relay = relayOf(msg);
      const user = relay ? realId(relay(msg)) : undefined;
      senders[key] = user ?? null;
      sc(key);
      if (user) {
        lookupGeneration++;
        scheduleRefresh();
      }
    } catch {
      failed.add(key);
    } finally {
      inflight.delete(key);
      lookupSlots++;
      const next = lookupWaiters.shift();
      if (next) next();
    }
  }

  function fixed(msg, channel = msg?.channel, ts = msg?.ts) {
    if (!msg || typeof msg !== 'object') return msg;
    if (plainMsgs.has(msg)) return msg;
    if (!msg.bot_id && !msg.attachments) {
      plainMsgs.add(msg);
      return msg;
    }
    const cached = msgCache.get(msg);
    if (cached && cached.gen === lookupGeneration) return cached.value;
    const relay = relayOf(msg);
    let out = msg;
    if (relay) {
      const user = realId(relay(msg)) ?? (channel && ts ? senderOf(channel, ts) : undefined);
      if (user) out = asSentBy(msg, user);
    }
    if (Array.isArray(out.attachments)) {
      const hasRelayForward = out.attachments.some((att) => att?.author_link && SERVICE_RE.test(att.author_link));
      if (hasRelayForward) {
        out = { ...out, __slickSRUForward: true };
        pendingForwards++;
      }
    }
    if (out === msg) return msg;
    msgCache.set(msg, { gen: lookupGeneration, value: out });
    return out;
  }

  let react = null;
  let jsxRuntime = null;
  const wrappedCreateElement = new WeakMap();
  const wrappedJsx = new WeakMap();

  function getReact() {
    if (react) return react;
    const r = getRequire();
    if (!r) return null;
    try {
      const isReact = (exp) => exp && typeof exp.createElement === 'function' && typeof exp.useState === 'function';
      const mod = findModule(r, '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED', null);
      if (mod && isReact(mod)) react = mod;
      if (!react) {
        for (const id of Object.keys(r.m || {})) {
          try {
            const exp = r(id);
            if (isReact(exp)) {
              react = exp;
              break;
            }
          } catch {}
        }
      }
    } catch {}
    return react;
  }

  function getJsxRuntime() {
    if (jsxRuntime) return jsxRuntime;
    const r = getRequire();
    if (!r) return null;
    try {
      const mod = findModule(r, 'react/jsx-runtime', null);
      if (mod && typeof mod.jsx === 'function' && typeof mod.jsxs === 'function') jsxRuntime = mod;
      if (!jsxRuntime) {
        for (const id of Object.keys(r.m || {})) {
          try {
            const exp = r(id);
            if (
              exp &&
              typeof exp === 'object' &&
              typeof exp.jsx === 'function' &&
              typeof exp.jsxs === 'function' &&
              'Fragment' in exp
            ) {
              jsxRuntime = exp;
              break;
            }
          } catch {}
        }
      }
    } catch {}
    return jsxRuntime;
  }

  function nameOf(type) {
    if (typeof type === 'function') return type.displayName || type.name || null;
    if (type && typeof type === 'object') {
      if (type.displayName) return type.displayName;
      if (type.type && typeof type.type === 'function') return type.type.displayName || type.type.name || null;
    }
    return null;
  }
  function typeName(type) {
    if (typeof type !== 'function' && (typeof type !== 'object' || type === null)) return null;
    const cached = nameCache.get(type);
    if (cached !== undefined) return cached;
    const name = nameOf(type);
    nameCache.set(type, name);
    return name;
  }

  function patchProps(type, props) {
    if (!props || typeof props !== 'object') return props;
    const name = typeName(type);
    if (!name || !PATCH_NAMES.has(name)) return props;

    if (name === 'MessageActionsMenu' || name === 'MessageActionsOverflowMenu') {
      const { channelId, ts, userId, botId } = props;
      if (!channelId || !ts) return props;
      if (userId || botId) return props;
      const real = senderOf(channelId, ts);
      if (!real) return props;
      const patched = { ...props, userId: real };
      delete patched.botId;
      return patched;
    }
    if (name === 'MessageListItem') {
      const found = props.result?.messages;
      if (!Array.isArray(found) || !found.length) return props;
      let out = null;
      for (let i = 0; i < found.length; i++) {
        const next = fixed(found[i]) ?? found[i];
        if (next === found[i]) continue;
        if (!out) out = found.slice();
        out[i] = next;
      }
      if (out) return { ...props, result: { ...props.result, messages: out } };
      return props;
    }
    if (!props.msg) return props;
    const next = fixed(props.msg);
    if (next === props.msg) return props;
    return { ...props, msg: next };
  }

  function wrapReact(R) {
    if (wrappedCreateElement.has(R)) return;
    const oce = R.createElement;
    R.createElement = function (type, props, ...children) {
      return oce(type, patchProps(type, props), ...children);
    };
    wrappedCreateElement.set(R, R.createElement);
  }
  function wrapJsx(rt) {
    if (wrappedJsx.has(rt)) return;
    const out = {};
    for (const key of ['jsx', 'jsxs']) {
      const orig = rt[key];
      if (!orig) continue;
      out[key] = function (type, props, ...children) {
        return orig(type, patchProps(type, props), ...children);
      };
      rt[key] = out[key];
    }
    wrappedJsx.set(rt, out);
  }
  function hookRender() {
    if (fullyHooked) return true;
    const R = getReact();
    if (R) wrapReact(R);
    const rt = getJsxRuntime();
    if (rt) wrapJsx(rt);
    fullyHooked = !!(R && rt);
    return fullyHooked;
  }

  async function finishForwards() {
    if (!pendingForwards || lastForwardScan === lookupGeneration) return false;
    lastForwardScan = lookupGeneration;
    const rows = document.querySelectorAll('.c-message_kit__message, .c-message, [role="listitem"]');
    let any = false;
    for (const row of rows) {
      const k = Object.keys(row).find(
        (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'),
      );
      if (!k) continue;
      let fiber = row[k];
      let hops = 0;
      while (fiber && hops < 20) {
        const p = fiber.memoizedProps;
        if (p?.msg && p.msg.__slickSRUForward) {
          const atts = await Promise.all((p.msg.attachments || []).map((att) => rewriteForward(att)));
          if (atts.some((att, i) => att !== p.msg.attachments[i])) {
            const fixedMsg = { ...p.msg, attachments: atts };
            delete fixedMsg.__slickSRUForward;
            fiber.memoizedProps = { ...p, msg: fixedMsg };
            msgCache.set(p.msg, fixedMsg);
            pendingForwards--;
            any = true;
          }
        }
        fiber = fiber.return;
        hops++;
      }
    }
    return any;
  }
  async function rewriteForward(att) {
    if (!att?.channel_id || !att.ts) return att;
    const botId = SERVICE_RE.exec(att.author_link ?? '')?.[1];
    if (!botId || !RELAY_BOTS[botId]) return att;
    const user = senderOf(att.channel_id, att.ts);
    if (!user) return att;
    const profile = await memberOf(user);
    const forwarded = {
      ...att,
      author_id: user,
      author_name: profile?.name || att.author_name,
      author_icon: profile?.icon ?? att.author_icon,
      author_link: profileLink(att.author_link, user),
    };
    delete forwarded.author_subname;
    return forwarded;
  }

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      hookRender();
      nudgeStore();
      void finishForwards().then((any) => {
        if (any) {
          try {
            window.dispatchEvent(new Event('resize'));
          } catch {}
        }
      });
    }, 25);
  }

  let tries = 0;
  (function boot() {
    hookCreateStore();
    patchMessageSelectors();
    wrapGetState(findStore());
    if (!hookRender()) {
      if (tries++ > 100) return;
      setTimeout(boot, 100);
    }
    const storeTimer = setInterval(() => {
      patchMessageSelectors();
      wrapGetState(findStore());
      if (messageSelectorsPatched) clearInterval(storeTimer);
    }, 1000);
    window.addEventListener('beforeunload', () => clearInterval(storeTimer), { once: true });
  })();
})();
