(function () {
  // port of https://github.com/jeremy46231/taut/blob/main/plugins/IdvStatus.tsx
  'use strict';
  if (window.__slickhca) return;

  const CACHE_KEY = 'slick:hca:status';
  const CACHE_TS_KEY = 'slick:hca:ts';
  const TTL = 24 * 60 * 60 * 1000;
  const MAX = 5000;
  const ID_RE = /^[UW][A-Z0-9]{6,}$/;
  const SEL = '.c-message__sender_button';

  let status = loadCache();
  const queued = new Set();
  const inflight = new Set();

  function loadCache() {
    try {
      const ts = localStorage.getItem(CACHE_TS_KEY);
      if (ts && Date.now() - parseInt(ts, 10) < TTL) {
        return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
      }
    } catch {}
    return {};
  }
  function saveCache() {
    try {
      const keys = Object.keys(status);
      if (keys.length > MAX) for (const k of keys.slice(0, keys.length - MAX)) delete status[k];
      localStorage.setItem(CACHE_KEY, JSON.stringify(status));
      localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
    } catch {}
  }

  function fiberOf(el) {
    const k = Object.keys(el).find(
      (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'),
    );
    return k ? el[k] : null;
  }
  function userIdOf(el) {
    let f = fiberOf(el);
    let hops = 0;
    while (f && hops < 25) {
      for (const p of [f.memoizedProps, f.pendingProps]) {
        if (!p) continue;
        if (p.botId || p.bot_id) return null;
        const cand = p.userId || p.user_id || (p.user && p.user.id) || (p.sender && p.sender.id) || p.authorUserId;
        if (typeof cand === 'string' && ID_RE.test(cand)) return cand;
      }
      f = f.return;
      hops++;
    }
    return null;
  }

  function paint(el) {
    const id = userIdOf(el);
    el.classList.remove('slick-hca-unverified', 'slick-hca-over-18');
    if (!id || id === 'USLACKBOT') return;
    const st = status[id];
    if (st === 'unverified') el.classList.add('slick-hca-unverified');
    else if (st === 'over_18') el.classList.add('slick-hca-over-18');
    else if (st === undefined && !inflight.has(id)) queued.add(id);
  }
  function paintAll() {
    document.querySelectorAll(SEL).forEach(paint);
  }

  window.__slickhca = {
    drain() {
      if (!queued.size) return [];
      const ids = [...queued];
      queued.clear();
      ids.forEach((id) => inflight.add(id));
      return ids;
    },
    apply(map) {
      let changed = false;
      for (const id in map) {
        inflight.delete(id);
        if (map[id]) {
          status[id] = map[id];
          changed = true;
        }
      }
      if (changed) saveCache();
      paintAll();
    },
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
