// Click2Load, main-process half.
//
// The renderer's src patch stops Slack asking for an embed, but not a request
// made some other way, so the block is enforced here as well. Nothing reaches
// a gated provider unless the user clicked the placeholder within the last few
// seconds.

import type { SlickMainPlugin } from '$slick';
import { PROVIDERS } from './meta.ts';

/** How long a click stays good for. Long enough to navigate, short enough
 *  that it is not a standing permission. */
const ALLOW_MS = 15_000;

const allowed = new Map<string, number>();

const patterns = PROVIDERS.flatMap((provider) =>
  provider.domains.flatMap((domain) => [`*://${domain}/*`, `*://*.${domain}/*`]),
);

function isAllowed(url: string): boolean {
  const expires = allowed.get(url);
  if (expires === undefined) return false;
  if (expires <= Date.now()) {
    allowed.delete(url);
    return false;
  }
  return true;
}

const plugin: SlickMainPlugin = {
  id: 'Click2Load',
  capabilities: ['requests'],

  ready(ctx) {
    return ctx.net.intercept(patterns, (details) => {
      // Only frames are gated. A stylesheet or image from the same host is
      // part of an embed that was already allowed.
      if (details.resourceType !== 'subFrame') return;

      const provider = PROVIDERS.find((candidate) =>
        candidate.domains.some((domain) => {
          try {
            const host = new URL(details.url).hostname;
            return host === domain || host.endsWith(`.${domain}`);
          } catch {
            return false;
          }
        }),
      );
      if (provider && ctx.settings[provider.key] === true) return;

      if (!isAllowed(details.url)) return { cancel: true };
    });
  },

  rpc: {
    allow(_ctx, args) {
      const [url] = args;
      if (typeof url !== 'string') throw new Error('bad argument');
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('bad protocol');
      } catch {
        throw new Error('bad url');
      }

      // Swept on write rather than on a timer: the map only grows when
      // someone clicks, so there is nothing to sweep when idle.
      const now = Date.now();
      for (const [key, expires] of allowed) if (expires <= now) allowed.delete(key);

      allowed.set(url, now + ALLOW_MS);
      return true;
    },
  },
};

export default plugin;
