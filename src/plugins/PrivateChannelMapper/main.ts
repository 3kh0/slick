// All Flaron (third-party) requests go through the main process: the page
// can't reach it cross-origin, and it keeps the network surface reviewable in
// one place. Only a channel id or the typed name is sent -- no token, team or
// identity. Both settings default off.

import type { MainCtx, SlickMainPlugin } from '$slick';
import { CHANNEL_ID } from './flaron.ts';

const FLARON = 'https://flaron.halceon.dev';
const UNKNOWN_TTL_MS = 24 * 60 * 60 * 1000;

const unknown = new Map<string, number>();
const CHANNEL_NAME = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function recentlyUnknown(key: string): boolean {
  const at = unknown.get(key);
  if (at === undefined) return false;
  if (Date.now() - at > UNKNOWN_TTL_MS) {
    unknown.delete(key);
    return false;
  }
  return true;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

async function ask(ctx: MainCtx, path: string, key: string): Promise<Record<string, unknown> | undefined> {
  if (recentlyUnknown(key)) return undefined;

  const response = await ctx.net.fetch(`${FLARON}${path}`);
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);

  const data = record(JSON.parse(response.body));
  if (data?.error === 'unknown') {
    unknown.set(key, Date.now());
    return undefined;
  }
  return data;
}

const plugin: SlickMainPlugin = {
  id: 'PrivateChannelMapper',
  capabilities: ['net'],

  rpc: {
    /** The name of one channel Slack will not name. */
    async channel(ctx, args) {
      // Mention candidates also need verification by id before they become a
      // shadow, even when general missing-name lookups are disabled.
      if (ctx.settings.flaron !== true && ctx.settings.mentions !== true)
        throw new Error('flaron lookups are disabled');
      const [id] = args;
      if (typeof id !== 'string' || !CHANNEL_ID.test(id)) throw new Error('bad channel id');

      const data = await ask(ctx, `/channel/${id}`, `id:${id}`);
      const name = typeof data?.name === 'string' ? data.name.trim().slice(0, 100) : '';
      return name || null;
    },

    /** The id behind a name the user typed, for the autocomplete path. */
    async byName(ctx, args) {
      if (ctx.settings.mentions !== true) throw new Error('mention lookups are disabled');
      const [name] = args;
      if (typeof name !== 'string' || !CHANNEL_NAME.test(name)) throw new Error('bad channel name');

      const data = await ask(ctx, `/cname/${encodeURIComponent(name)}`, `name:${name}`);
      const id = typeof data?.id === 'string' ? data.id : '';
      return CHANNEL_ID.test(id) ? id : null;
    },
  },
};

export default plugin;
