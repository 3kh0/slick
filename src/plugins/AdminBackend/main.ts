// Opens in the system browser. The renderer sends a tool id and member id and
// this builds the URL; an "open this URL" RPC would let any page script launch
// arbitrary external links.

import type { SlickMainPlugin } from '$slick';
import { TOOLS, USER_ID } from './meta.ts';

const plugin: SlickMainPlugin = {
  id: 'AdminBackend',
  capabilities: ['shell'],

  rpc: {
    async open(ctx, args) {
      const [target, memberId] = args;
      const tool = TOOLS.find((candidate) => candidate.id === target);
      if (!tool) throw new Error('unknown tool');
      if (typeof memberId !== 'string' || !USER_ID.test(memberId)) throw new Error('bad member id');
      // The renderer filters the menu, but the RPC is reachable without it.
      if (ctx.settings[tool.id] === false) throw new Error(`${tool.id} is disabled`);

      await ctx.shell.openExternal(tool.url(memberId));
    },
  },
};

export default plugin;
