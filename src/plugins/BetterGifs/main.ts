import type { SlickMainPlugin } from '$slick';
import { parseGifs, searchKlipy, searchTenor, topKlipy, topTenor, type Gif } from './gifs.ts';
import { id } from './meta.ts';

export const MAX_RESULT_BYTES = 192 * 1024;

export default {
  id,
  capabilities: ['net'],
  rpc: {
    async search(ctx, args) {
      const [provider, query] = args;
      if (args.length !== 2 || (provider !== 'tenor' && provider !== 'klipy')) throw new Error('Invalid GIF provider.');
      if (typeof query !== 'string') throw new Error('Invalid GIF search query.');
      const fetcher = (url: string) => ctx.net.fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(8_000) });
      const key = ctx.settings.klipyApiKey;
      const results = await (provider === 'tenor'
        ? query === ''
          ? topTenor(fetcher)
          : searchTenor(fetcher, query)
        : query === ''
          ? topKlipy(fetcher, typeof key === 'string' ? key : '')
          : searchKlipy(fetcher, typeof key === 'string' ? key : '', query));
      const gifs: Gif[] = [];
      const encoder = new TextEncoder();
      let bytes = 2;
      for (const gif of parseGifs(results)) {
        const size = encoder.encode(JSON.stringify(gif)).length + (gifs.length ? 1 : 0);
        if (bytes + size > MAX_RESULT_BYTES) break;
        gifs.push(gif);
        bytes += size;
      }
      return gifs;
    },
  },
} satisfies SlickMainPlugin;
