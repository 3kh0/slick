// ClearURLs, main-process half.
//
// Fetches the rule set, because it comes from raw.githubusercontent.com and
// the Slack page cannot reach a third-party origin.
//
// v1 pushed the rules into the page with `executeJavaScript` on every
// dom-ready -- a ~500KB JSON blob re-serialized into a script every time a
// window loaded. The renderer asks once instead, and the answer is cached both
// in memory and on disk.

import type { MainCtx, SlickMainPlugin } from '$slick';

const RULES_URL = 'https://raw.githubusercontent.com/ClearURLs/Rules/master/data.min.json';
const CACHE_KEY = 'rules.json';

let rules: Promise<unknown> | null = null;

async function fetchRules(ctx: MainCtx): Promise<unknown> {
  const cached = await ctx.storage.read(CACHE_KEY).catch(() => null);

  try {
    const response = await ctx.net.fetch(RULES_URL);
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);

    const data = JSON.parse(response.body);
    if (!data || typeof data.providers !== 'object') throw new Error('unexpected payload');

    await ctx.storage.write(CACHE_KEY, response.body).catch(() => {});
    ctx.log(`fetched ${Object.keys(data.providers).length} providers`);
    return data;
  } catch (error) {
    // Offline or rate limited is the normal case, not an error worth failing
    // the plugin over: a stale rule set still strips almost everything.
    ctx.log(`rules fetch failed (${(error as Error).message}), ${cached ? 'using the cached copy' : 'no cache'}`);
    if (!cached) return null;
    try {
      return JSON.parse(cached);
    } catch {
      return null;
    }
  }
}

const plugin: SlickMainPlugin = {
  id: 'ClearURLs',
  capabilities: ['net'],

  ready(ctx) {
    // Started here rather than on first call, so the rules are usually in hand
    // before the user sends anything.
    rules ??= fetchRules(ctx);
  },

  rpc: {
    rules(ctx) {
      rules ??= fetchRules(ctx);
      return rules;
    },
  },
};

export default plugin;
