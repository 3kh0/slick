// AdminBackend, main-process half.
//
// Opens in the system browser rather than a Slack window, which is the whole
// reason this needs a main half at all.
//
// The renderer asks for a tool by id and a member id; this builds the URL. It
// is deliberately not the other way round: handing the renderer a
// "open this URL" call would make any page script a way to launch arbitrary
// external links.
//
// v1 did the same thing by navigating to a fake `https://slick.admin-backend/`
// hostname and cancelling it in a `will-navigate` handler. Same allow-list,
// but over a channel that also had to be invisible to Slack.

import type { SlickMainPlugin } from '$slick';

const USER_ID = /^[UW][A-Z0-9]{6,}$/;

const TOOLS: Record<string, (id: string) => string> = {
  identity: (id) => `https://auth.hackclub.com/backend/identities?search=${encodeURIComponent(id)}`,
  joe: (id) => `https://joe.fraud.hackclub.com/profile/${encodeURIComponent(id)}`,
  telescreen: (id) => `https://telescreen.hackclub.com/subjects/${encodeURIComponent(id)}`,
  fire_engine: (id) => `https://nemo.hackclub.com/fd/members/${encodeURIComponent(id)}`,
};

const plugin: SlickMainPlugin = {
  id: 'AdminBackend',
  capabilities: ['shell'],

  rpc: {
    async open(ctx, args) {
      const [target, memberId] = args;
      if (typeof target !== 'string' || !Object.hasOwn(TOOLS, target)) throw new Error('unknown tool');
      if (typeof memberId !== 'string' || !USER_ID.test(memberId)) throw new Error('bad member id');
      // Respect the per-tool setting here too: the renderer already filters
      // the menu, but the RPC is reachable without it.
      if (ctx.settings[target] === false) throw new Error(`${target} is disabled`);

      await ctx.shell.openExternal(TOOLS[target](memberId));
    },
  },
};

export default plugin;
