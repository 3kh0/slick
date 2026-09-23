// Opens in the system browser. The renderer sends a tool id and member id and
// this builds the URL; an "open this URL" RPC would let any page script launch
// arbitrary external links.

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
      // The renderer filters the menu, but the RPC is reachable without it.
      if (ctx.settings[target] === false) throw new Error(`${target} is disabled`);

      await ctx.shell.openExternal(TOOLS[target](memberId));
    },
  },
};

export default plugin;
