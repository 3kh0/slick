// Firefox half. declarativeNetRequest can't run main.ts's per-request handler,
// so gated providers' frames are blocked by rule and a click adds a short-lived
// allow rule for that one URL.

import type { SlickBrowserPlugin } from '../../extension/mainHost.ts';
import { ALLOW_MS, allowableUrl } from './main.ts';
import { PROVIDERS } from './meta.ts';

const plugin: SlickBrowserPlugin = {
  id: 'Click2Load',
  capabilities: ['requests'],

  ready(ctx) {
    let unblock = () => {};
    const apply = () => {
      unblock();
      const gated = PROVIDERS.filter((provider) => ctx.settings[provider.key] !== true).flatMap((p) => p.domains);
      unblock = gated.length
        ? ctx.net.block(
            gated.flatMap((domain) => [`*://${domain}/*`, `*://*.${domain}/*`]),
            { resourceTypes: ['sub_frame'] },
          )
        : () => {};
    };
    apply();
    const off = ctx.onSettingsChange(apply);
    return () => {
      off();
      unblock();
    };
  },

  rpc: {
    // Resolves once the rule is live: the renderer sets the frame's src right after.
    async allow(ctx, args) {
      await ctx.net.allowOnce(allowableUrl(args[0]), ALLOW_MS);
      return true;
    },
  },
};

export default plugin;
