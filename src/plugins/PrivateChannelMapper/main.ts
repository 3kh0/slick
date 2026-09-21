// PrivateChannelMapper, main-process half.
//
// Flaron is a third party, so every request goes through here: the Slack page
// cannot reach it cross-origin, and routing it through the main process keeps
// the whole network surface of this plugin in one reviewable place.
//
// What is sent is exactly a channel id or the name the user typed, and nothing
// else. No token, no team, no identity. Both settings default off.

import type { MainCtx, SlickMainPlugin } from '$slick';
import { CHANNEL_ID } from './flaron.ts';

const FLARON = 'https://flaron.halceon.dev';
/** A channel name Flaron does not know is not worth re-asking about often. */
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

async function ask(ctx: MainCtx, path: string, key: string): Promise<unknown> {
  if (recentlyUnknown(key)) return null;

  const response = await ctx.net.fetch(`${FLARON}${path}`);
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);

  const data = JSON.parse(response.body);
  if (data?.error === 'unknown') {
    unknown.set(key, Date.now());
    return null;
  }
  return data;
}

const plugin: SlickMainPlugin = {
  id: 'PrivateChannelMapper',
  capabilities: ['net'],

  rpc: {
    /** The name of one channel Slack will not name. */
    async channel(ctx, args) {
      if (ctx.settings.flaron !== true) throw new Error('flaron lookups are disabled');
      const [id] = args;
      if (typeof id !== 'string' || !CHANNEL_ID.test(id)) throw new Error('bad channel id');

      const data = await ask(ctx, `/channel/${id}`, `id:${id}`);
      const name = typeof (data as any)?.name === 'string' ? (data as any).name.trim().slice(0, 100) : '';
      return name || null;
    },

    /** The id behind a name the user typed, for the autocomplete path. */
    async byName(ctx, args) {
      if (ctx.settings.mentions !== true) throw new Error('mention lookups are disabled');
      const [name] = args;
      if (typeof name !== 'string' || !CHANNEL_NAME.test(name)) throw new Error('bad channel name');

      const data = await ask(ctx, `/cname/${encodeURIComponent(name)}`, `name:${name}`);
      const id = typeof (data as any)?.id === 'string' ? (data as any).id : '';
      return CHANNEL_ID.test(id) ? id : null;
    },
  },
};

export default plugin;
