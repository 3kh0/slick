(function () {
  'use strict';
  if (window.__slickWhoReacted) return;

  function max() {
    const s = (window.__slickPluginSettings && window.__slickPluginSettings.WhoReacted) || {};
    return Math.max(1, Math.min(50, Number(s.maxAvatars) || 8));
  }

  const avatars = lc();
  const queued = new Set();
  const inflight = new Set();

  function lc() {
    try {
      const ts = localStorage.getItem('slick:wr:ts');
      if (ts && Date.now() - parseInt(ts, 10) < 24 * 60 * 60 * 1000) {
        return JSON.parse(localStorage.getItem('slick:wr:avatars')) || {};
      }
    } catch {}
    return {};
  }
  function sc() {
    try {
      const keys = Object.keys(avatars);
      if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 5000)) delete avatars[k];
      localStorage.setItem('slick:wr:avatars', JSON.stringify(avatars));
      localStorage.setItem('slick:wr:ts', String(Date.now()));
    } catch {}
  }

  function fiberOf(el) {
    const k = Object.keys(el).find(
      (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'),
    );
    return k ? el[k] : null;
  }
  function reactorsOf(el) {
    let f = fiberOf(el);
    let hops = 0;
    while (f && hops < 20) {
      const p = f.memoizedProps;
      if (p && Array.isArray(p.users) && typeof p.name === 'string' && typeof p.count === 'number') {
        return p.users.filter((id) => typeof id === 'string' && /^[UWB][A-Z0-9]{6,}$/.test(id));
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
    if (!chunks || !chunks.push) return null;
    chunks.push([['slick-who-reacted-' + Date.now()], {}, (require) => (webpackRequire = require)]);
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
    const routeTeamId = (location.pathname.match(/\/client\/([A-Z0-9]+)/) || [])[1];
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
    return keys.length > 0 && keys.every((k) => /^[UWB][A-Z0-9]{6,}$/.test(k)) && isUserObj(v[keys[0]]);
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
      if (isMemberMap(v)) return ((membersPath = [k]), v);
    }
    for (const [k, v] of Object.entries(state)) {
      if (!v || typeof v !== 'object') continue;
      for (const [k2, v2] of Object.entries(v)) {
        if (isMemberMap(v2)) return ((membersPath = [k, k2]), v2);
      }
    }
    return null;
  }

  function imu(u) {
    if (!isUserObj(u)) return null;
    const p = u.profile;
    return p.image_32 || p.image_24 || p.image_48 || p.image_72 || null;
  }

  function sa(id) {
    try {
      const state = currentState();
      if (!state) return null;
      const members = membersOf(state);
      if (!members) return null;
      return imu(members[id]);
    } catch {
      return null;
    }
  }

  function token() {
    try {
      const cfg = JSON.parse(localStorage.getItem('localConfig_v2'));
      const teams = (cfg && cfg.teams) || {};
      const routeTeamId = (location.pathname.match(/\/client\/([A-Z0-9]+)/) || [])[1];
      const team = teams[routeTeamId] || Object.values(teams).find((t) => t && t.token);
      return (team && team.token) || null;
    } catch {
      return null;
    }
  }
  async function fa(id) {
    const tok = token();
    if (!tok) return null;
    const body = new FormData();
    body.append('token', tok);
    body.append('user', id);
    try {
      const res = await fetch('/api/users.info', { method: 'POST', body });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.ok || !data.user) return null;
      const p = data.user.profile || {};
      return p.image_32 || p.image_24 || p.image_48 || p.image_72 || null;
    } catch {
      return null;
    }
  }

  function resolve(id) {
    if (id in avatars) return avatars[id];
    const fromStore = sa(id);
    if (fromStore) {
      avatars[id] = fromStore;
      sc();
      return fromStore;
    }
    if (!inflight.has(id)) queued.add(id);
    return undefined;
  }

  let drainScheduled = false;
  function drain() {
    if (drainScheduled || !queued.size) return;
    drainScheduled = true;
    const ids = [...queued].slice(0, 30);
    ids.forEach((id) => {
      queued.delete(id);
      inflight.add(id);
    });
    Promise.all(
      ids.map(async (id) => {
        avatars[id] = (await fa(id)) || null;
        inflight.delete(id);
      }),
    ).then(() => {
      drainScheduled = false;
      sc();
      schedulePaint();
      if (queued.size) drain();
    });
  }

  function paintReaction(btn) {
    const u = reactorsOf(btn);
    if (!u || !u.length) {
      const old = btn.querySelector(':scope > .slick-wr');
      if (old) old.remove();
      return;
    }
    const sig = u.join(',') + '|' + max();
    let box = btn.querySelector(':scope > .slick-wr');
    if (box && box.dataset.sig === sig) return;

    if (!box) {
      box = document.createElement('span');
      box.className = 'slick-wr';
      btn.appendChild(box);
    }
    box.textContent = '';

    const s = u.slice(0, max());
    let p = false;
    for (const id of s) {
      const url = resolve(id);
      if (url === undefined) p = true;
      if (!url) continue;
      const img = document.createElement('img');
      img.className = 'slick-wr__av';
      img.src = url;
      img.loading = 'lazy';
      box.appendChild(img);
    }
    box.dataset.sig = p ? '' : sig;
    const extra = u.length - s.length;
    if (extra > 0) {
      const more = document.createElement('span');
      more.className = 'slick-wr__more';
      more.textContent = '+' + extra;
      box.appendChild(more);
    }
    drain();
  }

  function pa() {
    document.querySelectorAll('.c-reaction').forEach(paintReaction);
  }

  function paintWithin(root) {
    const reactions = new Set();
    if (root.nodeType === Node.ELEMENT_NODE) {
      if (root.matches('.c-reaction')) reactions.add(root);
      const parent = root.closest('.c-reaction');
      if (parent) reactions.add(parent);
    }
    if (root.querySelectorAll) root.querySelectorAll('.c-reaction').forEach((reaction) => reactions.add(reaction));
    reactions.forEach(paintReaction);
  }

  let paintTimer = null;
  function schedulePaint() {
    if (paintTimer) return;
    paintTimer = setTimeout(() => {
      paintTimer = null;
      pa();
    }, 150);
  }

  window.__slickWhoReacted = { pa, avatars };

  let rootsTimer = null;
  const pendingRoots = new Set();
  function queue(root) {
    for (const pending of pendingRoots) {
      if (pending.contains(root)) return;
      if (root.contains(pending)) pendingRoots.delete(pending);
    }
    pendingRoots.add(root);
  }
  const obs = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) queue(node);
      });
    });
    if (!pendingRoots.size || rootsTimer) return;
    rootsTimer = setTimeout(() => {
      rootsTimer = null;
      const roots = [...pendingRoots];
      pendingRoots.clear();
      roots.forEach(paintWithin);
    }, 150);
  });
  function boot() {
    if (!document.body) return setTimeout(boot, 200);
    pa();
    obs.observe(document.body, { subtree: true, childList: true });
    window.addEventListener('slick:plugin-settings', schedulePaint);
  }
  boot();
})();
