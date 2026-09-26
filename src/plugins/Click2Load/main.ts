// The renderer's src patch doesn't catch every request, so the block is
// enforced here too: a gated provider loads only within ALLOW_MS of a click.

import type { SlickMainPlugin } from '$slick';
import { PROVIDERS } from './meta.ts';

/** Long enough to navigate, short enough not to be a standing permission. */
export const ALLOW_MS = 15_000;

const allowed = new Map<string, number>();

const patterns = PROVIDERS.flatMap((provider) =>
  provider.domains.flatMap((domain) => [`*://${domain}/*`, `*://*.${domain}/*`]),
);

/** The one argument of `allow`: an http(s) URL. Shared with browser.ts. */
export function allowableUrl(url: unknown): string {
  if (typeof url !== 'string') throw new Error('bad argument');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('bad protocol');
  } catch {
    throw new Error('bad url');
  }
  return url;
}

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
      // Only frames: subresources belong to an embed already allowed.
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
      const url = allowableUrl(args[0]);

      // Swept on write: the map only grows on click.
      const now = Date.now();
      for (const [key, expires] of allowed) if (expires <= now) allowed.delete(key);

      allowed.set(url, now + ALLOW_MS);
      return true;
    },
  },
};

export default plugin;
