(function () {
  // source: https://github.com/anirudhb/rope/blob/master/src/plugins/PrivateChannelMapper.tsx
  // thanks ani! ur the best :)
  // mention support ported from https://github.com/jeremy46231/taut/blob/main/plugins/PrivateChannel.tsx
  'use strict';
  if (window.__slickPCM) return;
  window.__slickPCM = true;

  const SEL = '.c-missing_channel--private';
  const ID_RE = /^[CGD][A-Z0-9]{6,}$/;
  const FLARON = 'https://flaron.halceon.dev';

  let names = read('slick:pcm:names');

  const FLARON_KEY = 'slick:pcm:flaron';
  const FLARON_UNKNOWN_KEY = 'slick:pcm:flaron-unknown';

  function setting(key) {
    return !!((window.__slickPluginSettings && window.__slickPluginSettings.PrivateChannelMapper) || {})[key];
  }
  function flaronEnabled() {
    return setting('flaron');
  }

  const cachedFlaron = read(FLARON_KEY);
  const flaronUnknown = read(FLARON_UNKNOWN_KEY);
  const failedFlaron = new Set();
  const pendingFlaron = new Set();

  function read(key) {
    let raw;
    try {
      raw = JSON.parse(localStorage.getItem(key)) || {};
    } catch {
      return {};
    }
    const clean = {};
    for (const k of Object.keys(raw)) if (ID_RE.test(k)) clean[k] = raw[k];
    return clean;
  }
  function write(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {}
  }

  function fiberOf(el) {
    const k = Object.keys(el).find(
      (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'),
    );
    return k ? el[k] : null;
  }
  function fiberChannelId(el) {
    let f = fiberOf(el);
    let hops = 0;
    let fallback = null;
    while (f && hops < 20) {
      for (const props of [f.memoizedProps, f.pendingProps]) {
        if (props && typeof props.id === 'string' && ID_RE.test(props.id)) {
          if ('isNonExistent' in props) return props.id;
          if (!fallback) fallback = props.id;
        }
      }
      f = f.return;
      hops++;
    }
    return fallback;
  }

  function idOf(el) {
    const cached = el.dataset.slickPcmId;
    if (cached && ID_RE.test(cached)) return cached;
    const id = fiberChannelId(el);
    if (id) el.dataset.slickPcmId = id;
    return id;
  }

  function labelTextNode(el) {
    for (let i = el.childNodes.length - 1; i >= 0; i--) {
      const n = el.childNodes[i];
      if (n.nodeType === Node.TEXT_NODE && n.nodeValue.trim()) return n;
    }
    const n = document.createTextNode('');
    el.appendChild(n);
    return n;
  }

  function flaronUnknownRecently(id) {
    const ts = flaronUnknown[id];
    if (typeof ts !== 'number') return false;
    if (Date.now() - ts < 24 * 60 * 60 * 1000) return true;
    delete flaronUnknown[id];
    return false;
  }

  function getFlaron(id) {
    if (cachedFlaron[id] || pendingFlaron.has(id) || failedFlaron.has(id)) return;
    if (flaronUnknownRecently(id)) return;
    pendingFlaron.add(id);
    fetch(FLARON + '/channel/' + id)
      .then((r) => r.json())
      .then((data) => {
        const name = data && typeof data.name === 'string' ? data.name.trim().slice(0, 100) : '';
        if (name) {
          cachedFlaron[id] = name;
          write(FLARON_KEY, cachedFlaron);
          applyAll();
        } else if (data && data.error === 'unknown') {
          flaronUnknown[id] = Date.now();
          write(FLARON_UNKNOWN_KEY, flaronUnknown);
        } else {
          failedFlaron.add(id);
        }
      })
      .catch(() => {
        failedFlaron.add(id);
      })
      .finally(() => pendingFlaron.delete(id));
  }

  function apply(el) {
    const id = idOf(el);
    if (!id) return;
    const custom = names[id];
    const known = custom || (shadows.get(id) || {}).name;
    let flaron;
    if (!known && flaronEnabled()) {
      getFlaron(id);
      flaron = cachedFlaron[id];
    }
    const want = known || flaron || id;
    el.title = want === id ? '' : id;

    const node = labelTextNode(el);
    if (node.nodeValue !== want) node.nodeValue = want;
    el.classList.toggle('slick-pcm--named', !!custom);
    el.classList.toggle('slick-pcm--flaron', want !== id && !custom);
  }

  function applyAll() {
    document.querySelectorAll(SEL).forEach(apply);
  }

  function applyWithin(root) {
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(SEL)) apply(root);
    if (root.querySelectorAll) root.querySelectorAll(SEL).forEach(apply);
  }

  let overlay = null;
  function closeEditor() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }
  function startEdit(el) {
    closeEditor();
    const id = idOf(el);
    if (!id) return;
    const r = el.getBoundingClientRect();
    const input = document.createElement('input');
    overlay = input;
    input.value = names[id] || '';
    input.placeholder = id;
    input.setAttribute(
      'style',
      `position:fixed;left:${Math.round(r.left)}px;top:${Math.round(r.top)}px;` +
        `min-width:${Math.max(120, Math.round(r.width) + 24)}px;z-index:2147483647;` +
        `font:inherit;padding:2px 6px;border-radius:6px;border:1px solid #3a3a3a;` +
        `background:#000;color:#fff;outline:none`,
    );
    document.body.appendChild(input);
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = input.value.trim();
        if (v) names[id] = v;
        else delete names[id];
        write('slick:pcm:names', names);
        closeEditor();
        applyAll();
      } else if (e.key === 'Escape') {
        closeEditor();
      }
    });
    input.addEventListener('blur', closeEditor);
  }

  document.addEventListener('dblclick', (e) => {
    const el = e.target.closest && e.target.closest(SEL);
    if (el) {
      e.preventDefault();
      startEdit(el);
    }
  });

  /* ---------- mentioning private channels you are not in ----------
   * Composer autocomplete searches Slack's own redux `channels` slice, so we layer
   * Flaron name/id pairs on top of it at read time. Slack's data always wins and
   * nothing is written back, so turning the setting off restores stock behaviour.
   */

  const SHADOW_KEY = 'slick:pcm:shadows';
  const SHADOW_MAX = 200;
  const QUERY_RE = /^[^\s#@,<>]{2,80}$/;
  const SEARCH_KEY = 'slick-private-channel';

  const SETTLE_MS = 250;

  const shadows = new Map();
  const missedNames = new Set();
  const pendingNames = new Map();
  let stateVersion = 0;
  let latestQuery = '';

  // true once `query` is the last thing typed and the user has stopped
  const settled = (query) =>
    new Promise((resolve) => setTimeout(() => resolve(latestQuery === query), latestQuery === query ? SETTLE_MS : 0));

  const deburr = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '');

  function makeChannel(id, name) {
    return {
      id,
      name,
      name_normalized: deburr(name),
      _name_lc: deburr(name.toLowerCase()),
      is_channel: false,
      is_group: true,
      is_im: false,
      is_mpim: false,
      is_private: true,
      is_member: false,
      is_archived: false,
      is_general: false,
      previous_names: [],
      isNonExistent: false,
      isUnknown: false,
    };
  }

  function loadShadows() {
    const saved = read(SHADOW_KEY);
    for (const id of Object.keys(saved)) {
      if (typeof saved[id] === 'string' && saved[id]) shadows.set(id, makeChannel(id, saved[id]));
    }
  }

  function addShadow(id, name) {
    shadows.delete(id);
    shadows.set(id, makeChannel(id, name));
    while (shadows.size > SHADOW_MAX) shadows.delete(shadows.keys().next().value);
    stateVersion++;
    const out = {};
    for (const [key, ch] of shadows) out[key] = ch.name;
    write(SHADOW_KEY, out);
    applyAll();
  }

  let webpackRequire = null;
  function getWebpackRequire() {
    if (webpackRequire) return webpackRequire;
    const chunks = window.webpackChunkwebapp || window.rspackChunkwebapp;
    if (!chunks || !chunks.push) return null;
    chunks.push([['slick-private-channel-' + Date.now()], {}, (require) => (webpackRequire = require)]);
    return webpackRequire;
  }
  // ids are minified, so match on source. Cache only on a hit (the map fills lazily)
  // and read only instantiated modules (requiring one early can have side effects).
  const needleIds = new Map();
  function moduleByNeedle(r, needle) {
    let id = needleIds.get(needle);
    if (!id && (id = Object.keys(r.m || {}).find((k) => String(r.m[k]).includes(needle)))) needleIds.set(needle, id);
    return id && r.c && r.c[id] ? r.c[id].exports : null;
  }

  function findStore(r) {
    const mod = moduleByNeedle(r, 'getStoreInstanceMap');
    const getStores =
      mod && Object.values(mod).find((v) => typeof v === 'function' && v.name === 'getStoreInstanceMap');
    if (!getStores) return null;
    const stores = getStores() || {};
    const routeTeamId = (location.pathname.match(/\/client\/([A-Z0-9]+)/) || [])[1];
    const list = Object.values(stores).filter(
      (s) => typeof s?.getState === 'function' && typeof s?.dispatch === 'function',
    );
    return (
      stores[routeTeamId] ||
      list.find((s) => s.getState()?.selfTeamIds?.teamId === routeTeamId) ||
      (list.length === 1 ? list[0] : null)
    );
  }

  // The local searcher enumerates the channel slice's prototype and memoizes on the
  // slice's identity, so a shadow only lands if both are fresh objects.
  const wrappedStores = new WeakSet();
  function wrapStore(store) {
    if (!store || typeof store.getState !== 'function' || wrappedStores.has(store)) return;
    wrappedStores.add(store);
    const orig = store.getState.bind(store);
    let cachedRaw = null;
    let cachedVersion = -1;
    let cachedOut = null;
    store.getState = () => {
      const raw = orig();
      if (!shadows.size || !setting('mentions') || !raw || !raw.channels) return raw;
      if (raw === cachedRaw && cachedVersion === stateVersion) return cachedOut;
      const rawChannels = raw.channels;
      const proto = Object.assign({}, Object.getPrototypeOf(rawChannels));
      for (const [id, ch] of shadows) if (!(proto[id] || {}).name) proto[id] = ch;
      const channels = Object.create(proto, Object.getOwnPropertyDescriptors(rawChannels));
      cachedRaw = raw;
      cachedVersion = stateVersion;
      cachedOut = Object.create(Object.getPrototypeOf(raw), {
        ...Object.getOwnPropertyDescriptors(raw),
        channels: { value: channels, enumerable: true, configurable: true, writable: true },
      });
      return cachedOut;
    };
  }

  function wrapStores(r) {
    const mod = r && moduleByNeedle(r, 'getStoreInstanceMap');
    const getStores =
      mod && Object.values(mod).find((v) => typeof v === 'function' && v.name === 'getStoreInstanceMap');
    if (getStores) for (const store of Object.values(getStores() || {})) wrapStore(store);
  }

  const ROW_COMPONENTS = ['Connect(SmallChannelListEntity)', 'Connect(SmallChannelEntity)'];
  let rowsPatched = false;
  let internalsTries = 0;
  function patchRowsSoon() {
    if (rowsPatched || !setting('mentions')) return;
    const react = window.__slickInternals && window.__slickInternals.react;
    if (!react || !react.patchProps) {
      if (internalsTries++ < 100) setTimeout(patchRowsSoon, 100);
      return;
    }
    rowsPatched = true;
    for (const name of ROW_COMPONENTS)
      react.patchProps(name, (props) => {
        if (!setting('mentions') || !props || (props.channel && props.channel.name)) return props;
        const shadow = shadows.get(props.channelId);
        return shadow ? Object.assign({}, props, { channel: shadow }) : props;
      });
  }

  async function resolveName(name) {
    if (missedNames.has(name)) return false;
    let pending = pendingNames.get(name);
    if (!pending) {
      pending = fetch(FLARON + '/cname/' + encodeURIComponent(name))
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .finally(() => pendingNames.delete(name));
      pendingNames.set(name, pending);
    }
    const data = await pending;
    // public channels come back with full metadata, private ones only {id, name}
    if (!data || !ID_RE.test(data.id || '') || typeof data.name !== 'string' || 'created' in data) {
      if (data) missedNames.add(name);
      return false;
    }
    addShadow(data.id, data.name);
    return true;
  }

  const resultId = (r) => (r && (r.item ? r.item.id : r.id)) || '';
  const resultName = (r) => (r && (r.item ? r.item.name : r.name)) || '';

  function mergeResults(base, extra) {
    const seen = new Set(base.map(resultId));
    return base.concat(extra.filter((res) => resultId(res) && !seen.has(resultId(res))));
  }

  // Slack ranks by frecency and has none for a channel it cannot see, so a shadow
  // spelled out in full would otherwise sit below fuzzy matches
  function hoistShadows(list, query) {
    const mine = list.filter((res) => shadows.has(resultId(res)) && resultName(res).toLowerCase() === query);
    return mine.length ? mine.concat(list.filter((res) => !mine.includes(res))) : list;
  }

  function patchSearcher(r, store) {
    const mod = moduleByNeedle(r, 'searchLocalAsync');
    const getSearcher = mod && Object.values(mod).find((v) => typeof v === 'function');
    if (!getSearcher) return false;
    const teamId = store.getState()?.selfTeamIds?.teamId;
    let ours;
    try {
      ours = getSearcher({ teamId, key: SEARCH_KEY });
    } catch {
      return false;
    }
    const proto = ours && Object.getPrototypeOf(ours);
    if (!proto || typeof proto.search !== 'function' || proto.__slickPCM) return !!(proto && proto.__slickPCM);
    const origSearch = proto.search;
    proto.__slickPCM = true;
    proto.search = function (args) {
      const out = origSearch.apply(this, arguments);
      const options = args && args.options;
      if (this === ours || !setting('mentions')) return out;
      if (!options || !options.tiered || !(options.entities || {}).channels) return out;
      if ((options.sort || {}).source !== 'texty-autocomplete') return out;
      const query = String(args.query || '')
        .trim()
        .replace(/^#/, '')
        .toLowerCase();
      if (!QUERY_RE.test(query)) return out;
      latestQuery = query;

      return Promise.resolve(out).then((local) => {
        if (!Array.isArray(local)) return local;
        const merged = Promise.resolve(local.promise).then(async (remote) => {
          const base = Array.isArray(remote) ? remote : local;
          if (base.some((res) => resultName(res).toLowerCase() === query)) return hoistShadows(base, query);
          // ask Flaron only about the name typing stopped on, or every prefix of it
          // becomes a request and a stray shadow
          if (!(await settled(query))) return base;
          if (!(await resolveName(query))) return base;
          // our own searcher, so the rerun does not abort the composer's live request
          const rerun = await origSearch.call(ours, args);
          return Array.isArray(rerun) ? hoistShadows(mergeResults(base, rerun), query) : base;
        });
        // Slack sometimes hands back a frozen array, so extend a copy
        const fresh = hoistShadows(local.slice(), query);
        fresh.promise = merged;
        return fresh;
      });
    };
    return true;
  }

  let mentionsReady = false;
  let mentionTries = 0;
  function initMentions() {
    if (!setting('mentions')) return;
    patchRowsSoon();
    const r = getWebpackRequire();
    if (r) wrapStores(r);
    if (mentionsReady) return;
    const store = r && findStore(r);
    if (store && patchSearcher(r, store)) {
      mentionsReady = true;
      applyAll();
      return;
    }
    // the search bundle loads lazily, so keep looking for a little while
    if (mentionTries++ < 40) setTimeout(initMentions, 250);
  }

  function boot() {
    if (!document.body) {
      setTimeout(boot, 200);
      return;
    }
    loadShadows();
    applyAll();
    window.__slickDOM.onRoots((roots) => roots.forEach(applyWithin), { charData: true });
    window.addEventListener('slick:plugin-settings', () => {
      applyAll();
      initMentions();
    });
    // hold the redux and search patches back until a mention is actually typed
    document.addEventListener('keydown', (e) => e.key === '#' && initMentions(), true);
    if (shadows.size) initMentions();
  }
  boot();
})();
