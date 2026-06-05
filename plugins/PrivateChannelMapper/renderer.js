(function () {
  // source: https://github.com/anirudhb/rope/blob/master/src/plugins/PrivateChannelMapper.tsx
  // thanks ani! ur the best :)
  'use strict';
  if (window.__slickPCM) return;
  window.__slickPCM = true;

  const KEY = 'slick:pcm:names';
  const SEL = '.c-missing_channel--private';
  const ID_RE = /^[CGD][A-Z0-9]{6,}$/;

  let names = read();
  function read() {
    let raw;
    try {
      raw = JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
    const clean = {};
    for (const k of Object.keys(raw)) if (ID_RE.test(k)) clean[k] = raw[k];
    return clean;
  }
  function write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(names));
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

  function apply(el) {
    const id = idOf(el);
    if (!id) return;
    const custom = names[id];
    el.title = custom ? id : '';
    const node = labelTextNode(el);
    const want = custom || id;
    if (node.nodeValue !== want) node.nodeValue = want;
    el.classList.toggle('slick-pcm--named', !!custom);
  }

  function applyAll() {
    document.querySelectorAll(SEL).forEach(apply);
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
        write();
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
  const obs = new MutationObserver(() => {
    if (t) return;
    t = setTimeout(() => {
      t = null;
      applyAll();
    }, 150);
  });
  function boot() {
    if (!document.body) {
      setTimeout(boot, 200);
      return;
    }
    applyAll();
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
  }
  boot();
})();
