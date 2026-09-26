import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MainCtx, SlickMainPlugin } from '../shared/main.ts';
import { createMainHost, patternToFilter, type Dnr, type SlickBrowserPlugin } from './mainHost.ts';
import { validRequest } from './rpc.ts';

function fakeDnr() {
  let rules: any[] = [];
  const dnr: Dnr = {
    getSessionRules: async () => rules.map((rule) => ({ id: rule.id })),
    updateSessionRules: async ({ addRules = [], removeRuleIds = [] }) => {
      rules = [...rules.filter((rule) => !removeRuleIds.includes(rule.id)), ...addRules];
    },
  };
  return { dnr, rules: () => rules };
}

function memoryArea() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (key: string | string[]) => ({ [String(key)]: structuredClone(data[String(key)]) }),
    set: async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items)),
    remove: async () => {},
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('match patterns become domain-anchored filters; anything fancier is refused', () => {
  assert.equal(patternToFilter('*://slackb.com/*'), '||slackb.com/');
  assert.equal(patternToFilter('*://*.slack.com/beacon/*'), '||slack.com/beacon/');
  assert.equal(patternToFilter('https://*.Spotify.com/*'), '||spotify.com/');
  for (const bad of ['<all_urls>', '*://*/*', '*://a.com/x*y*', 'ftp://a.com/*'])
    assert.throws(() => patternToFilter(bad));
});

test('main.ts halves start on enable, block only Slack-initiated requests, and stop cleanly', async () => {
  const { dnr, rules } = fakeDnr();
  let disposed = 0;
  const plugin: SlickMainPlugin = {
    id: 'NoTrack',
    capabilities: ['requests'],
    ready(ctx) {
      const unblock = ctx.net.block(['*://slackb.com/*', '*://*.slackb.com/*']);
      return () => {
        disposed++;
        unblock();
      };
    },
  };
  const host = createMainHost(memoryArea(), dnr, [{ plugin, schema: {}, defaultEnabled: false }]);
  await host.reset();
  await host.update({ plugins: {} });
  await settle();
  assert.deepEqual(rules(), []);

  await host.update({ plugins: { NoTrack: { enabled: true } } });
  await settle();
  // Both patterns collapse to one filter: `||` already covers subdomains.
  assert.equal(rules().length, 1);
  assert.deepEqual(rules()[0].condition, { urlFilter: '||slackb.com/', initiatorDomains: ['app.slack.com'] });
  assert.equal(rules()[0].action.type, 'block');

  host.setExempt(7, true);
  await settle();
  assert.deepEqual(rules()[0].condition.excludedTabIds, [7]);
  host.setExempt(7, false);
  await settle();
  assert.equal(rules()[0].condition.excludedTabIds, undefined);

  // The global switch stops privileged halves too, as on desktop.
  await host.update({ enabled: false, plugins: { NoTrack: { enabled: true } } });
  await settle();
  assert.equal(disposed, 1);
  assert.deepEqual(rules(), []);
});

test('undeclared capabilities and desktop-only ctx APIs fail loudly', async () => {
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args) => void errors.push(args);
  try {
    const plugins: SlickMainPlugin[] = [
      { id: 'A', capabilities: [], ready: (ctx) => void ctx.net.block(['*://a.com/*']) },
      { id: 'B', capabilities: ['requests'], ready: (ctx) => void ctx.net.intercept(['*://b.com/*'], () => {}) },
    ];
    const host = createMainHost(
      memoryArea(),
      fakeDnr().dnr,
      plugins.map((plugin) => ({ plugin, schema: {}, defaultEnabled: true })),
    );
    await host.update({});
    assert.equal(host.running('A'), false);
    assert.equal(host.running('B'), false);
    assert.match(String(errors.flat().join(' ')), /without declaring it/);
    assert.match(String(errors.flat().join(' ')), /unavailable in Firefox/);
  } finally {
    console.error = original;
  }
});

test('rpc reaches own methods of running plugins only; allowOnce expires', async () => {
  const { dnr, rules } = fakeDnr();
  const plugin: SlickBrowserPlugin = {
    id: 'Click2Load',
    capabilities: ['requests'],
    rpc: {
      async allow(ctx, [url]) {
        await ctx.net.allowOnce(String(url), 20);
        return true;
      },
    },
  };
  const host = createMainHost(memoryArea(), dnr, [{ plugin, schema: {}, defaultEnabled: false }]);
  await assert.rejects(host.call('Click2Load', 'allow', ['https://x.test/a']), /disabled/);
  await host.update({ plugins: { Click2Load: { enabled: true } } });
  await assert.rejects(host.call('Click2Load', 'toString', []), /unknown method/);
  await assert.rejects(host.call('Nope', 'allow', []), /no background half/);
  assert.equal(await host.call('Click2Load', 'allow', ['https://x.test/a?b=1']), true);
  // Already applied when the call resolves: no settle needed.
  assert.deepEqual(rules()[0].action, { type: 'allow' });
  assert.equal(rules()[0].priority, 2);
  assert.equal(rules()[0].condition.regexFilter, '^https://x\\.test/a\\?b=1$');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(rules(), []);
});

test('settings reach running halves; storage is per plugin and bounded', async () => {
  const area = memoryArea();
  const seen: unknown[] = [];
  let storage!: MainCtx['storage'];
  const plugin: SlickMainPlugin = {
    id: 'ClearURLs',
    capabilities: ['net'],
    ready(ctx) {
      storage = ctx.storage;
      ctx.onSettingsChange((settings) => seen.push(settings.flag));
    },
  };
  const schema = { flag: { type: 'boolean', label: 'Flag', default: false } } as const;
  const host = createMainHost(area, undefined, [{ plugin, schema, defaultEnabled: false }]);
  await host.update({ plugins: { ClearURLs: { enabled: true } } });
  await host.update({ plugins: { ClearURLs: { enabled: true, flag: true } } });
  assert.deepEqual(seen, [true]);

  assert.equal(await storage.write('rules.json', 'x'.repeat(200_000)), true);
  assert.equal((await storage.read('rules.json'))?.length, 200_000);
  assert.deepEqual(Object.keys(area.data), ['slick:firefox:main:ClearURLs']);
  await assert.rejects(storage.write('huge', 'x'.repeat(1024 * 1024)), /quota/);
  assert.deepEqual(await storage.list(), ['rules.json']);
});

test('plugin.call and tabMode requests are validated before reaching the background', () => {
  assert.equal(validRequest({ method: 'plugin.call', args: ['Click2Load', 'allow', '["https://x"]'] }), true);
  assert.equal(
    validRequest({ method: 'plugin.call', args: ['PrivateChannelMapper', 'channel', '["C0266FRGT"]'] }),
    true,
  );
  assert.equal(validRequest({ method: 'plugin.call', args: ['AccountSwitcher', 'switch', '[]'] }), false);
  assert.equal(validRequest({ method: 'plugin.call', args: ['NoTrack', '__proto__.x', '[]'] }), false);
  assert.equal(validRequest({ method: 'plugin.call', args: ['NoTrack', 'x', '[]', 'extra'] }), false);
  assert.equal(validRequest({ method: 'tabMode', args: ['safe'] }), true);
  assert.equal(validRequest({ method: 'tabMode', args: ['off'] }), false);
});
