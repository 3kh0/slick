(function () {
  'use strict';
  if (window.__slickPronouns) return;

  const ID_RE = /^[UW][A-Z0-9]{6,}$/;

  let cache = loadCache();
  let dirty = false;
  const queued = new Set();
  const inflight = new Set();

  function loadCache() {
    try {
      const ts = localStorage.getItem('slick:pronouns:ts');
      if (ts && Date.now() - parseInt(ts, 10) < 24 * 60 * 60 * 1000) {
        return JSON.parse(localStorage.getItem('slick:pronouns')) || {};
      }
    } catch {}
    return {};
  }
  function saveCache() {
    try {
      const keys = Object.keys(cache);
      if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 5000)) delete cache[k];
      localStorage.setItem('slick:pronouns', JSON.stringify(cache));
      localStorage.setItem('slick:pronouns:ts', String(Date.now()));
      dirty = false;
    } catch {}
  }

  const clean = (v) =>
    String(v ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
  const pronounsOf = (u) => clean(u?.profile?.pronouns);

  function fiberOf(el) {
    const k = Object.keys(el).find((s) => s.startsWith('__reactFiber$') || s.startsWith('__reactInternalInstance$'));
    return k ? el[k] : null;
  }
  function userIdOf(el) {
    let f = fiberOf(el);
    let hops = 0;
    while (f && hops < 40) {
      for (const p of [f.memoizedProps, f.pendingProps]) {
        if (!p || typeof p !== 'object') continue;
        if (p.botId || p.bot_id) return null;
        const m = p.message;
        if (m && typeof m === 'object') {
          if (m.bot_id || m.subtype === 'bot_message') return null;
          if (typeof m.user === 'string' && ID_RE.test(m.user)) return m.user;
        }
        const cand = p.userId || p.user_id || (p.user && p.user.id) || (p.sender && p.sender.id) || p.authorUserId;
        if (typeof cand === 'string' && ID_RE.test(cand)) return cand;
      }
      f = f.return;
      hops++;
    }
    return null;
  }

  let webpackRequire = null;
  function getWebpackRequire() {
    if (webpackRequire) return webpackRequire;
    const chunks = window.webpackChunkwebapp;
    if (!chunks?.push) return null;
    chunks.push([
      ['slick-user-pronouns-' + Date.now()],
      {},
      (require) => {
        webpackRequire = require;
      },
    ]);
    return webpackRequire;
  }
  const findModule = (require, needle, fallbackId) =>
    require(Object.keys(require.m || {}).find((k) => String(require.m[k]).includes(needle)) || fallbackId);

  let getStores = null;
  function currentState() {
    if (!getStores) {
      const r = getWebpackRequire();
      if (!r) return null;
      getStores =
        Object.values(findModule(r, 'getStoreInstanceMap', 0x1856bb20b)).find(
          (v) => typeof v === 'function' && v.name === 'getStoreInstanceMap',
        ) || null;
    }
    if (!getStores) return null;
    const stores = getStores() || {};
    const routeTeamId = location.pathname.match(/\/client\/([A-Z0-9]+)/)?.[1];
    let store = routeTeamId && stores[routeTeamId];
    if (!store) {
      const list = Object.values(stores).filter(
        (s) => typeof s?.getState === 'function' && typeof s?.dispatch === 'function',
      );
      store =
        list.find((s) => s.getState()?.selfTeamIds?.teamId === routeTeamId) || (list.length === 1 ? list[0] : null);
    }
    return store && typeof store.getState === 'function' ? store.getState() : null;
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
    return keys.length > 0 && keys.every((k) => ID_RE.test(k)) && isUserObj(v[keys[0]]);
  }

  let membersPath = null;
  let nextScan = 0;
  function membersOf(state) {
    if (membersPath) {
      const hit = membersPath.reduce((obj, k) => (obj == null ? null : obj[k]), state);
      if (isMemberMap(hit)) return hit;
      membersPath = null;
    }
    if (Date.now() < nextScan) return null;
    nextScan = Date.now() + 5000;
    for (const [k, v] of Object.entries(state)) {
      if (isMemberMap(v)) {
        membersPath = [k];
        return v;
      }
    }
    for (const [k, v] of Object.entries(state)) {
      if (!v || typeof v !== 'object') continue;
      for (const [k2, v2] of Object.entries(v)) {
        if (isMemberMap(v2)) {
          membersPath = [k, k2];
          return v2;
        }
      }
    }
    return null;
  }

  function storePronouns(id) {
    try {
      const state = currentState();
      if (!state) return null;
      const members = membersOf(state);
      if (!members) return null;
      const u = members[id];
      return isUserObj(u) ? pronounsOf(u) : null;
    } catch {
      return null;
    }
  }

  async function fetch(id) {
    let token = null;
    try {
      const cfg = JSON.parse(localStorage.getItem('localConfig_v2'));
      const teams = (cfg && cfg.teams) || {};
      const routeTeamId = location.pathname.match(/\/client\/([A-Z0-9]+)/)?.[1];
      const team = teams[routeTeamId] || Object.values(teams).find((t) => t && t.token);
      token = (team && team.token) || null;
    } catch {}
    if (!token) return null;
    const body = new FormData();
    body.append('token', token);
    body.append('user', id);
    const res = await fetch('/api/users.info', { method: 'POST', body });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) return data && data.error === 'user_not_found' ? '' : null;
    return pronounsOf(data.user);
  }
  setInterval(() => {
    if (!queued.size) return;
    const ids = [...queued].slice(0, 4);
    for (const id of ids) {
      queued.delete(id);
      inflight.add(id);
    }
    Promise.all(
      ids.map(async (id) => {
        const p = await fetch(id).catch(() => null);
        inflight.delete(id);
        if (p !== null) {
          cache[id] = p;
          dirty = true;
        } else {
          cache[id] = '';
        }
      }),
    ).then(() => {
      if (dirty) saveCache();
      paintAll();
    });
  }, 1200);

  function pronounsFor(id) {
    const fromStore = storePronouns(id);
    if (fromStore !== null) {
      if (cache[id] !== fromStore) {
        cache[id] = fromStore;
        dirty = true;
      }
      return fromStore;
    }
    if (id in cache) return cache[id];
    if (!inflight.has(id)) queued.add(id);
    return '';
  }

  function paint(ts) {
    const row = ts.closest('.c-message_kit__message, .c-message, [data-qa="message_container"], [role="listitem"]');
    const sender =
      row &&
      row.querySelector(
        '.c-message__sender, .c-message__sender_button, [data-qa="message_sender"], [data-qa="message_sender_name"]',
      );
    if (!sender) return;
    const compact = !!ts.closest('.p-message_pane_message__compact_timestamp');
    const anchor = compact ? sender.closest('.c-message__sender') || sender : ts;
    const tag = row.querySelector('.slick-pronouns');
    const id = userIdOf(sender);
    const p = id ? pronounsFor(id) : '';
    if (!p) {
      if (tag) tag.remove();
      return;
    }
    let el = tag;
    if (!el) {
      el = document.createElement('span');
      el.className = 'slick-pronouns';
    }
    el.classList.toggle('slick-pronouns--compact', compact);
    if (anchor.nextElementSibling !== el) anchor.after(el);
    if (el.textContent !== p) el.textContent = p;
  }
  let lastTsColor = '';
  function syncColor() {
    const label = document.querySelector('.c-timestamp__label');
    if (!label) return;
    const color = getComputedStyle(label).color;
    if (color && color !== lastTsColor) {
      lastTsColor = color;
      document.documentElement.style.setProperty('--slick-pronouns-color', color);
    }
  }

  function paintAll() {
    syncColor();
    document.querySelectorAll('.c-timestamp').forEach(paint);
    if (dirty) saveCache();
  }

  window.__slickPronouns = {
    apply: paintAll,
    get: (id) => cache[id] ?? null,
  };

  let t = null;
  const obs = new MutationObserver(() => {
    if (t) return;
    t = setTimeout(() => {
      t = null;
      paintAll();
    }, 200);
  });
  function boot() {
    if (!document.body) return setTimeout(boot, 200);
    paintAll();
    obs.observe(document.body, { subtree: true, childList: true });
  }
  boot();
})();
