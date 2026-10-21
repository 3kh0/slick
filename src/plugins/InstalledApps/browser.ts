// Web half: the extension background or Violentmonkey reads the page with the
// browser's slack.com cookies (the extension needs its optional *.slack.com access).

import type { SlickBrowserPlugin } from '../../extension/mainHost.ts';
import { appPageData } from './data.ts';
import { UNAVAILABLE, marketplaceUrl } from './main.ts';
import { id } from './meta.ts';

const plugin: SlickBrowserPlugin = {
  id,
  capabilities: ['net'],

  rpc: {
    async marketplace(ctx, [appId, teamId]) {
      const response = await ctx.net.fetch(marketplaceUrl(appId, teamId), {
        credentials: 'include',
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status < 200 || response.status >= 300) throw new Error(UNAVAILABLE);
      return appPageData(response.body);
    },
  },
};

export default plugin;
