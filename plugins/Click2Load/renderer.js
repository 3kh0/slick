'use strict';

(() => {
  if (window.__slickClick2LoadLoaded) return;
  window.__slickClick2LoadLoaded = true;

  const MESSAGE_FRAME = [
    '[data-qa="message_container"]',
    '[data-qa="message_content"]',
    '.c-message_kit__message',
    '.c-message_kit__blocks',
    '.c-message_kit__gutter',
    '[data-qa="virtual-list-item"]',
  ].join(',');
  const INTERNAL_DOMAINS = ['slack.com', 'slack-edge.com', 'slack-imgs.com', 'slackb.com', 'slack-core.com'];
  const PROVIDERS = [
    { key: 'spotify', label: 'Spotify', domains: ['spotify.com'] },
    { key: 'soundcloud', label: 'SoundCloud', domains: ['soundcloud.com'] },
  ];

  const states = new WeakMap();
  const iframeSrc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
  const iframeSrcdoc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
  const setAttribute = Element.prototype.setAttribute;
  const removeAttribute = Element.prototype.removeAttribute;
  const getAttribute = Element.prototype.getAttribute;

  const matchesDomain = (host, domains) => domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  const config = () => window.__slickPluginSettings?.Click2Load || {};
  const allowed = (provider) => config()[provider.key] === true;

  function parseSource(value) {
    try {
      const url = new URL(String(value), location.href);
      if (url.hostname === 'slick.click2load') return new URL(url.searchParams.get('url'));
      return url;
    } catch {
      return null;
    }
  }

  function providerFor(frame, source) {
    const url = parseSource(source);
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
    const known = PROVIDERS.find((provider) => matchesDomain(url.hostname, provider.domains));
    if (known) return known;
    if (!frame.isConnected || !frame.closest(MESSAGE_FRAME) || matchesDomain(url.hostname, INTERNAL_DOMAINS))
      return null;
    return { key: 'other', label: url.hostname };
  }

  function gateway(source) {
    const url = new URL('https://slick.click2load/');
    url.searchParams.set('url', source);
    return url.href;
  }

  const escapeHTML = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );

  function x(state) {
    const href = escapeHTML(gateway(state.source));
    const destination = escapeHTML(state.source);
    return (
      '<!doctype html><meta name="color-scheme" content="light dark"><style>html,body{height:100%;margin:0;background:transparent}body{font:600 14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{box-sizing:border-box;display:grid;grid-template-rows:auto 1fr;align-items:center;width:100%;height:100%;min-height:72px;padding:18px;border:1px solid color-mix(in srgb,CanvasText 25%,transparent);border-radius:16px;color:CanvasText;text-align:center;text-decoration:none;outline-offset:-4px}a:hover .url{text-decoration:underline}.label{align-self:start}.url{align-self:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:400;word-break:break-all}</style><a href="' +
      href +
      '" referrerpolicy="no-referrer" aria-label="Click to load ' +
      destination +
      ' embed"><span class="label">Click to load</span><span class="url">' +
      destination +
      '</span></a>'
    );
  }

  function apply(frame, state) {
    const mode = allowed(state.provider) ? 'allowed' : 'blocked';
    if (state.mode === mode) return;
    state.mode = mode;

    if (mode === 'allowed') {
      removeAttribute.call(frame, 'srcdoc');
      iframeSrc.set.call(frame, gateway(state.source));
      frame.removeAttribute('data-slick-click2load');
      return;
    }

    removeAttribute.call(frame, 'src');
    iframeSrcdoc.set.call(frame, x(state));
    frame.setAttribute('data-slick-click2load', state.provider.key);
    frame.setAttribute('title', `Click to load ${state.provider.label} embed`);
  }

  function route(frame, value) {
    const parsed = parseSource(value);
    const source = parsed?.href || String(value);
    const provider = providerFor(frame, source);
    if (!provider) {
      states.delete(frame);
      if (iframeSrc.get.call(frame) !== source) iframeSrc.set.call(frame, value);
      return;
    }

    const state = { source, provider, mode: '' };
    states.set(frame, state);
    apply(frame, state);
  }

  function sync(frame, refresh = false) {
    const state = states.get(frame);
    if (state) {
      if (refresh) state.mode = '';
      apply(frame, state);
      return;
    }
    const source = getAttribute.call(frame, 'src');
    if (source) route(frame, source);
  }

  if (iframeSrc?.configurable && iframeSrcdoc?.set) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
      configurable: true,
      enumerable: iframeSrc.enumerable,
      get() {
        return states.get(this)?.source || iframeSrc.get.call(this);
      },
      set(value) {
        route(this, value);
      },
    });

    Element.prototype.setAttribute = function (name, value) {
      if (this instanceof HTMLIFrameElement && String(name).toLowerCase() === 'src') {
        route(this, value);
        return;
      }
      setAttribute.call(this, name, value);
    };
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target instanceof HTMLIFrameElement) sync(record.target);
        continue;
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLIFrameElement) sync(node);
        node.querySelectorAll('iframe').forEach(sync);
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  });

  document.querySelectorAll('iframe').forEach(sync);
  window.addEventListener('slick:plugin-settings', () =>
    document.querySelectorAll('iframe').forEach((frame) => sync(frame, true)),
  );
})();
