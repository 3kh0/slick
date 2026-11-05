import type { SlickMainPlugin } from '$slick';
import { brandingOf, VIDEO_ID } from './branding.ts';
import { id } from './meta.ts';

export default {
  id,
  capabilities: ['net'],

  rpc: {
    async branding(ctx, args) {
      const [videoId] = args;
      if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) throw new Error('bad video id');

      const response = await ctx.net.fetch(`https://sponsor.ajay.app/api/branding?videoID=${videoId}`);
      if (response.status === 404) return null;
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
      return brandingOf(JSON.parse(response.body));
    },
  },
} satisfies SlickMainPlugin;
