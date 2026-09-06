'use strict';

const legacy = require('../../plugins/ClearURLs');

// Provider rules are supplied by the platform (the extension service worker or
// the desktop main process), never fetched from the page. Untrusted patterns are
// compiled into RegExp objects, so both the count and the length are capped.
function coerceRules(value) {
  if (!value || typeof value !== 'object' || !value.providers || typeof value.providers !== 'object') return null;
  const providers = {};
  let count = 0;
  for (const [name, provider] of Object.entries(value.providers)) {
    if (count >= 500) break;
    if (!provider || typeof provider !== 'object' || typeof provider.urlPattern !== 'string') continue;
    if (provider.urlPattern.length > 400) continue;
    const list = (entries) =>
      (Array.isArray(entries) ? entries : [])
        .filter((entry) => typeof entry === 'string' && entry.length <= 400)
        .slice(0, 100);
    providers[name] = {
      urlPattern: provider.urlPattern,
      rules: list(provider.rules),
      rawRules: list(provider.rawRules),
      exceptions: list(provider.exceptions),
    };
    count++;
  }
  return count ? { providers } : null;
}

module.exports = {
  id: 'ClearURLs',
  description: legacy.meta.description,
  defaultEnabled: false,
  settings: {
    extraRules: legacy.settings.extraRules,
    rules: { type: 'data', label: 'Provider rules', default: null, coerce: coerceRules, platform: true },
  },
  setup: function setup(api) {
    const compileRegExp = (pattern) => new RegExp(pattern, 'i');
    let signature;
    let providers = [];
    let extra = [];
    function compile() {
      const next = `${JSON.stringify(api.settings.rules)} ${api.settings.extraRules}`;
      if (next === signature) return;
      signature = next;
      const rules = api.settings.rules;
      providers = Object.values(rules?.providers || {}).flatMap((provider) => {
        try {
          return [
            {
              urlPattern: compileRegExp(provider.urlPattern),
              rules: provider.rules.map(compileRegExp),
              rawRules: provider.rawRules.map(compileRegExp),
              exceptions: provider.exceptions.map(compileRegExp),
            },
          ];
        } catch (error) {
          api.fail(error);
          return [];
        }
      });
      const escape = (value) => value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
      const wildcard = (value) => escape(value).replace(/\\\*/g, '.+?');
      extra = String(api.settings.extraRules || '')
        .split(',')
        .map((rule) => rule.trim())
        .filter(Boolean)
        .flatMap((rule) => {
          const [param, host] = rule.split('@');
          try {
            return [
              {
                param: new RegExp(`^${wildcard(param)}$`),
                host: host
                  ? new RegExp(
                      `^(www\\.)?${escape(host)
                        .replace(/^\\\*\\\./, '(.+?\\.)?')
                        .replace(/\\\*/g, '.+?')}$`,
                    )
                  : null,
              },
            ];
          } catch (error) {
            api.fail(error);
            return [];
          }
        });
    }
    compile();
    api.subscribe(compile);

    const drop = (params, predicate) => {
      const doomed = [];
      params.forEach((_value, key) => predicate(key) && doomed.push(key));
      doomed.forEach((key) => params.delete(key));
      return doomed.length;
    };
    function cleanURL(value) {
      let url;
      try {
        url = new URL(value);
      } catch {
        return value;
      }
      if (url.searchParams.entries().next().done) return value;
      let removed = 0;
      for (const provider of providers) {
        if (!provider.urlPattern.test(url.href) || provider.exceptions.some((rule) => rule.test(url.href))) continue;
        removed += drop(url.searchParams, (key) => provider.rules.some((rule) => rule.test(key)));
        let href = url.href;
        for (const raw of provider.rawRules) {
          const next = href.replace(raw, '');
          if (next === href) continue;
          href = next;
          removed++;
        }
        if (href !== url.href) {
          try {
            url = new URL(href);
          } catch {}
        }
      }
      removed += drop(url.searchParams, (key) =>
        extra.some((rule) => (!rule.host || rule.host.test(url.hostname)) && rule.param.test(key)),
      );
      if (!removed) return value;
      api.count('cleaned', removed);
      return url.toString();
    }
    const URL_PATTERN = /(https?:\/\/[^\s<|]+[^<.,:;"'>)|\]\s])/g;
    const cleanText = (text) => (/https?:\/\//.test(text) ? text.replace(URL_PATTERN, cleanURL) : text);
    function walkBlocks(node) {
      if (Array.isArray(node)) return node.forEach(walkBlocks);
      if (!node || typeof node !== 'object') return;
      if (node.type === 'link' && typeof node.url === 'string') {
        const cleaned = cleanURL(node.url);
        if (cleaned !== node.url) {
          if (typeof node.text === 'string' && /^https?:\/\//.test(node.text)) node.text = cleaned;
          node.url = cleaned;
        }
      } else if (node.type === 'text' && typeof node.text === 'string') node.text = cleanText(node.text);
      for (const key in node) if (key !== 'text') walkBlocks(node[key]);
    }
    const overJSON = (json, fn) => {
      try {
        const value = JSON.parse(json);
        fn(value);
        return JSON.stringify(value);
      } catch {
        return json;
      }
    };
    const cleaners = {
      blocks: (json) => overJSON(json, walkBlocks),
      text: cleanText,
      unfurl: (json) =>
        overJSON(json, (list) =>
          list.forEach((entry) => entry && typeof entry.url === 'string' && (entry.url = cleanURL(entry.url))),
        ),
      url: cleanURL,
    };
    const API_PATTERN = /\/api\/chat\.(postMessage|update|scheduleMessage|unfurlLink)/;
    function cleanBody(body) {
      // FormData and URLSearchParams are mutated in place: Slack keeps its own
      // reference to the object it handed us.
      if (
        (typeof FormData === 'function' && body instanceof FormData) ||
        (typeof URLSearchParams === 'function' && body instanceof URLSearchParams)
      ) {
        for (const [key, cleaner] of Object.entries(cleaners)) {
          const value = body.get(key);
          if (typeof value === 'string') body.set(key, cleaner(value));
        }
        return body;
      }
      if (typeof body === 'string' && body[0] === '{') {
        try {
          const parsed = JSON.parse(body);
          for (const key in cleaners) if (typeof parsed[key] === 'string') parsed[key] = cleaners[key](parsed[key]);
          if (parsed.blocks && typeof parsed.blocks !== 'string') walkBlocks(parsed.blocks);
          return JSON.stringify(parsed);
        } catch {}
      }
      return body;
    }
    api.installed(
      api.net.request((request) => {
        if (!request.body || !API_PATTERN.test(request.url)) return;
        request.setBody(cleanBody(request.body));
      }),
    );
  },
};
