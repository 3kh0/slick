(function () {
  // source: https://github.com/anirudhb/rope/blob/master/src/plugins/PrivateChannelMapper.tsx
  // thanks ani! ur the best :)
  'use strict';
  if (window.__slickPCM) return;
  window.__slickPCM = true;

  const SEL = '.c-missing_channel--private';
  const ID_RE = /^[CGD][A-Z0-9]{6,}$/;

  let names = read('slick:pcm:names');

  const FLARON_KEY = 'slick:pcm:flaron';
  const FLARON_UNKNOWN_KEY = 'slick:pcm:flaron-unknown';

  function flaronEnabled() {
    return !!window.__slickPluginSettings?.PrivateChannelMapper?.flaron;
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
    fetch('https://flaron.halceon.dev/channel/' + id)
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
    let flaron;
    if (!custom && flaronEnabled()) {
      getFlaron(id);
      flaron = cachedFlaron[id];
    }
    const want = custom || flaron || id;
    el.title = want === id ? '' : id;

    const node = labelTextNode(el);
    if (node.nodeValue !== want) node.nodeValue = want;
    el.classList.toggle('slick-pcm--named', !!custom);
    el.classList.toggle('slick-pcm--flaron', !!flaron);
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

  let t = null;
  const pendingRoots = new Set();
  function queue(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    for (const pending of pendingRoots) {
      if (pending.contains(root)) return;
      if (root.contains(pending)) pendingRoots.delete(pending);
    }
    pendingRoots.add(root);
  }
  const obs = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'characterData') queue(mutation.target.parentElement?.closest(SEL));
      mutation.addedNodes.forEach(queue);
    });
    if (!pendingRoots.size) return;
    if (t) return;
    t = setTimeout(() => {
      t = null;
      const roots = [...pendingRoots];
      pendingRoots.clear();
      roots.forEach(applyWithin);
    }, 150);
  });
  function boot() {
    if (!document.body) {
      setTimeout(boot, 200);
      return;
    }
    applyAll();
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
    window.addEventListener('slick:plugin-settings', applyAll);
  }
  boot();
})();
