(function () {
  'use strict';
  if (window.__slickClearURLs) return;
  const state = (window.__slickClearURLs = { cleaned: 0, last: null, providers: 0 });

  const re = (r) => new RegExp(r, 'i');
  const res = (a) => (a || []).map(re);

  let providers = [];
  function buildProviders() {
    const d = window.__slickClearURLsData;
    if (!d || typeof d.providers !== 'object') return;
    providers = Object.values(d.providers).flatMap((p) => {
      try {
        return [
          {
            urlPattern: re(p.urlPattern),
            rules: res(p.rules),
            rawRules: res(p.rawRules),
            exceptions: res(p.exceptions),
          },
        ];
      } catch (e) {
        return [];
      }
    });
    state.providers = providers.length;
  }
  buildProviders();
  window.addEventListener('slick:clearurls-rules', buildProviders);

  const esc = (s) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  const wild = (s) => esc(s).replace(/\\\*/g, '.+?');

  let extra = [];
  function compile() {
    const s = (window.__slickPluginSettings || {}).ClearURLs || {};
    extra = String(s.extraRules || '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const [param, host] = r.split('@');
        return {
          param: new RegExp('^' + wild(param) + '$'),
          host: host
            ? new RegExp(
                '^(www\\.)?' +
                  esc(host)
                    .replace(/^\\\*\\\./, '(.+?\\.)?')
                    .replace(/\\\*/g, '.+?') +
                  '$',
              )
            : null,
        };
      });
  }
  compile();
  window.addEventListener('slick:plugin-settings', compile);

  const drop = (sp, pred) => {
    const d = [];
    sp.forEach((_, k) => pred(k) && d.push(k));
    d.forEach((k) => sp.delete(k));
    return d.length;
  };

  function cleanURL(str) {
    let url;
    try {
      url = new URL(str);
    } catch (e) {
      return str;
    }
    if (url.searchParams.entries().next().done) return str;
    let removed = 0;
    for (const p of providers) {
      if (!p.urlPattern.test(url.href) || p.exceptions.some((ex) => ex.test(url.href))) continue;
      removed += drop(url.searchParams, (k) => p.rules.some((r) => r.test(k)));
      let href = url.href;
      for (const raw of p.rawRules) {
        const next = href.replace(raw, '');
        if (next !== href) {
          href = next;
          removed++;
        }
      }
      if (href !== url.href) {
        try {
          url = new URL(href);
        } catch (e) {}
      }
    }
    removed += drop(url.searchParams, (k) =>
      extra.some((r) => (!r.host || r.host.test(url.hostname)) && r.param.test(k)),
    );
    if (!removed) return str;
    state.cleaned += removed;
    return (state.last = url.toString());
  }

  const URL_RE = /(https?:\/\/[^\s<|]+[^<.,:;"'>)|\]\s])/g;
  const cleanText = (t) => (/https?:\/\//.test(t) ? t.replace(URL_RE, cleanURL) : t);

  function walkBlocks(node) {
    if (Array.isArray(node)) return node.forEach(walkBlocks);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'link' && typeof node.url === 'string') {
      const c = cleanURL(node.url);
      if (c !== node.url) {
        if (typeof node.text === 'string' && /^https?:\/\//.test(node.text)) node.text = c;
        node.url = c;
      }
    } else if (node.type === 'text' && typeof node.text === 'string') node.text = cleanText(node.text);
    for (const k in node) if (k !== 'text') walkBlocks(node[k]);
  }

  const overJSON = (json, fn) => {
    try {
      const v = JSON.parse(json);
      fn(v);
      return JSON.stringify(v);
    } catch (e) {
      return json;
    }
  };

  const cleaners = {
    blocks: (j) => overJSON(j, walkBlocks),
    text: cleanText,
    unfurl: (j) => overJSON(j, (a) => a.forEach((u) => u && typeof u.url === 'string' && (u.url = cleanURL(u.url)))),
    url: cleanURL,
  };

  const API_RE = /\/api\/chat\.(postMessage|update|scheduleMessage|unfurlLink)/;

  function cleanBody(body) {
    if (body instanceof FormData || body instanceof URLSearchParams) {
      for (const [k, fn] of Object.entries(cleaners)) {
        const v = body.get(k);
        if (typeof v === 'string') body.set(k, fn(v));
      }
      return body;
    }
    if (typeof body === 'string' && body[0] === '{') {
      try {
        const o = JSON.parse(body);
        for (const k in cleaners) if (typeof o[k] === 'string') o[k] = cleaners[k](o[k]);
        if (o.blocks && typeof o.blocks !== 'string') walkBlocks(o.blocks);
        return JSON.stringify(o);
      } catch (e) {}
    }
    return body;
  }

  const ogFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const u = typeof input === 'string' ? input : (input && input.url) || String(input);
      if (API_RE.test(u) && init && init.body) init.body = cleanBody(init.body);
    } catch (e) {}
    return ogFetch.apply(this, arguments);
  };

  const ogOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (_m, url) {
    this.__slickClearURLs = API_RE.test(String(url));
    return ogOpen.apply(this, arguments);
  };
  const ogSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (this.__slickClearURLs && body) arguments[0] = cleanBody(body);
    } catch (e) {}
    return ogSend.apply(this, arguments);
  };
})();
