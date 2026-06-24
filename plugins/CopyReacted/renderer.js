(function () {
  'use strict';
  if (window.__slickCopyReacted) return;

  function cfg() {
    return (window.__slickPluginSettings && window.__slickPluginSettings.CopyReacted) || {};
  }
  function fmtMode() {
    const f = cfg().format;
    return f === 'handles' || f === 'mentions' ? f : 'names';
  }
  function sep() {
    return cfg().separator === 'comma' ? ', ' : '\n';
  }

  const users = lc();
  const queued = new Set();
  const inflight = new Set();

  function lc() {
    try {
      const ts = localStorage.getItem('slick:cr:ts');
      if (ts && Date.now() - parseInt(ts, 10) < 24 * 60 * 60 * 1000) {
        return JSON.parse(localStorage.getItem('slick:cr:users')) || {};
      }
    } catch {}
    return {};
  }
  function sc() {
    try {
      const keys = Object.keys(users);
      if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 5000)) delete users[k];
      localStorage.setItem('slick:cr:users', JSON.stringify(users));
      localStorage.setItem('slick:cr:ts', String(Date.now()));
    } catch {}
  }

  function fiberOf(el) {
    const k = Object.keys(el).find(
      (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'),
    );
    return k ? el[k] : null;
  }
  function reactionOf(el) {
    let f = fiberOf(el);
    let hops = 0;
    while (f && hops < 20) {
      const p = f.memoizedProps;
      if (p && Array.isArray(p.users) && typeof p.name === 'string' && typeof p.count === 'number') {
        return {
          name: p.name,
          count: p.count,
          users: p.users.filter((id) => typeof id === 'string' && /^[UWB][A-Z0-9]{6,}$/.test(id)),
        };
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
    chunks.push([['slick-copy-reacted-' + Date.now()], {}, (require) => (webpackRequire = require)]);
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

  function infoOf(u) {
    if (!isUserObj(u)) return null;
    const p = u.profile || {};
    const name = p.display_name || p.real_name || u.real_name || u.name || u.id;
    const handle = u.name || p.display_name || name;
    return { name, handle };
  }
  function fromStore(id) {
    try {
      const state = currentState();
      if (!state) return null;
      const members = membersOf(state);
      if (!members) return null;
      return infoOf(members[id]);
    } catch {
      return null;
    }
  }

  function token() {
    try {
      const conf = JSON.parse(localStorage.getItem('localConfig_v2'));
      const teams = (conf && conf.teams) || {};
      const routeTeamId = (location.pathname.match(/\/client\/([A-Z0-9]+)/) || [])[1];
      const team = teams[routeTeamId] || Object.values(teams).find((t) => t && t.token);
      return (team && team.token) || null;
    } catch {
      return null;
    }
  }
  async function fetchInfo(id) {
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
      return infoOf(data.user);
    } catch {
      return null;
    }
  }

  function resolve(id) {
    if (id in users && users[id]) return users[id];
    const s = fromStore(id);
    if (s) {
      users[id] = s;
      sc();
      return s;
    }
    if (!inflight.has(id)) queued.add(id);
    return null;
  }
  function drain() {
    const ids = [...queued].slice(0, 50);
    if (!ids.length) return Promise.resolve();
    ids.forEach((id) => {
      queued.delete(id);
      inflight.add(id);
    });
    return Promise.all(
      ids.map(async (id) => {
        const info = (await fetchInfo(id)) || { name: id, handle: id };
        users[id] = info;
        inflight.delete(id);
      }),
    ).then(() => {
      sc();
      if (queued.size) return drain();
    });
  }

  function render(id) {
    const i = users[id] || resolve(id) || { name: id, handle: id };
    const m = fmtMode();
    return m === 'mentions' ? `<@${id}>` : m === 'handles' ? '@' + i.handle : i.name;
  }

  async function buildList(ids) {
    ids.forEach(resolve);
    if (queued.size) await drain();
    return [...new Set(ids)].map(render).join(sep());
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  function toast(msg) {
    let t = document.querySelector('.slick-cr__toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'slick-cr__toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('slick-cr__toast--on');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('slick-cr__toast--on'), 1800);
  }

  let openMenu = null;
  function closeMenu() {
    if (openMenu) {
      openMenu.remove();
      openMenu = null;
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
    }
  }
  function onDocDown(e) {
    if (openMenu && !openMenu.contains(e.target)) closeMenu();
  }
  function onKey(e) {
    if (e.key === 'Escape') closeMenu();
  }

  async function doCopy(ids) {
    closeMenu();
    if (!ids.length) return toast('No reactors');
    const ok = await copy(await buildList(ids));
    toast(ok ? `Copied ${new Set(ids).size} reactors` : 'Copy failed');
  }

  function reactionsForBar(bar) {
    return [...bar.querySelectorAll('.c-reaction')]
      .map((el) => {
        const r = reactionOf(el);
        return r && r.users.length ? { ...r, emoji: el.querySelector('img.c-emoji, .c-emoji, .emoji') } : null;
      })
      .filter(Boolean);
  }

  function openFor(barBtn, bar) {
    closeMenu();
    const reactions = reactionsForBar(bar);
    const all = reactions.flatMap((r) => r.users);

    const menu = document.createElement('div');
    menu.className = 'slick-cr__menu';

    const addRow = (text, ids, emoji) => {
      const row = document.createElement('button');
      row.className = 'slick-cr__row';
      if (emoji) {
        const e = emoji.cloneNode(true);
        e.classList.add('slick-cr__emoji');
        e.removeAttribute('width');
        e.removeAttribute('height');
        row.appendChild(e);
      }
      const label = document.createElement('span');
      label.className = 'slick-cr__label';
      label.textContent = text;
      row.appendChild(label);
      row.addEventListener('click', () => doCopy(ids));
      menu.appendChild(row);
    };

    addRow(`Everyone (${new Set(all).size})`, all);
    if (reactions.length > 1) {
      const sepEl = document.createElement('div');
      sepEl.className = 'slick-cr__sep';
      menu.appendChild(sepEl);
      reactions.forEach((r) => addRow(`:${r.name}: (${r.users.length})`, r.users, r.emoji));
    }

    document.body.appendChild(menu);
    const rect = barBtn.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let top = rect.bottom + 4;
    if (top + mh > window.innerHeight) top = rect.top - mh - 4;
    let left = rect.left;
    if (left + mw > window.innerWidth) left = window.innerWidth - mw - 8;
    menu.style.top = Math.max(4, top) + 'px';
    menu.style.left = Math.max(4, left) + 'px';

    openMenu = menu;
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
  }

  function barsOf() {
    return new Set([...document.querySelectorAll('.c-reaction')].map((r) => r.parentElement).filter(Boolean));
  }

  function paintBar(bar) {
    if (!bar.querySelector('.c-reaction')) return;
    let btn = bar.querySelector(':scope > .slick-cr__btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'slick-cr__btn';
      btn.type = 'button';
      btn.title = 'Copy reactors';
      btn.setAttribute('aria-label', 'Copy reactors');
      btn.innerHTML =
        '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M13 2H6a2 2 0 0 0-2 2v9h2V4h7V2zm3 4H10a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm0 10h-6V8h6v8z"/></svg>';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (openMenu) return closeMenu();
        openFor(btn, bar);
      });
      bar.appendChild(btn);
    }
  }

  function pa() {
    barsOf().forEach(paintBar);
  }

  let paintTimer = null;
  function schedulePaint() {
    if (paintTimer) return;
    paintTimer = setTimeout(() => {
      paintTimer = null;
      pa();
    }, 150);
  }

  window.__slickCopyReacted = { pa, users, reactionsForBar };

  const obs = new MutationObserver(schedulePaint);
  function boot() {
    if (!document.body) return setTimeout(boot, 200);
    pa();
    obs.observe(document.body, { subtree: true, childList: true });
    window.addEventListener('slick:plugin-settings', schedulePaint);
    window.addEventListener('scroll', closeMenu, true);
  }
  boot();
})();
