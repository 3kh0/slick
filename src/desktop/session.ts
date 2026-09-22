// Slick Desktop Session
// Serves the app bundle over the privileged slick:// scheme.
//
// Slick is embedded-only: slick.js ships inside the app's resources and is
// never fetched from a CDN. SLICK_APP_URL exists so `npm run dev` can point the
// loader at a local dev server; it is a development escape hatch, not a feature.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { session } from 'electron';
import { editorHtml, MONACO_URL_PREFIX } from './windows/cssEditor.ts';

export const SLICK_SCHEME = 'slick';

/** Must be called before app is ready. */
export function privilegedSchemes() {
  return [
    {
      scheme: SLICK_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ];
}

export function appUrl(): string {
  return process.env.SLICK_APP_URL || 'slick://app/slick.js';
}

/**
 * Serve slick.js over slick://.
 *
 * `dirs` are searched in order. A packaged build finds it in Slick's own
 * resources (captured before patch.ts spoofs `resourcesPath` to Slack's); an
 * unpackaged dev run finds it next to main.js, because there `resourcesPath`
 * belongs to the Electron binary rather than to us.
 */
/** Monaco ships .js and .css only; anything else is not ours to serve. */
const MONACO_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const notFound = () => new Response('Not found', { status: 404 });

export function setupSession(dirs: string[]) {
  const candidates = dirs.map((dir) => path.join(dir, 'slick.js'));
  const monacoDirs = dirs.map((dir) => path.join(dir, 'monaco'));

  session.defaultSession.protocol.handle(SLICK_SCHEME, (request) => {
    const url = new URL(request.url);
    const file = url.pathname.replace(/^\//, '');

    // The custom-CSS editor. Its HTML is generated rather than stored, so the
    // Monaco base URL and the version stay in one place.
    if (url.hostname === 'editor') {
      if (file === '' || file === 'index.html') {
        return new Response(editorHtml(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      const prefix = MONACO_URL_PREFIX.replace(/^\//, '');
      if (!file.startsWith(prefix)) return notFound();

      // Resolved and re-checked against the root, so a `..` in the request
      // cannot walk out of the Monaco directory.
      const relative = file.slice(prefix.length);
      const type = MONACO_TYPES[path.extname(relative).toLowerCase()];
      if (!type) return notFound();

      for (const root of monacoDirs) {
        const target = path.resolve(root, 'vs', relative);
        if (target !== path.resolve(root, 'vs') && !target.startsWith(path.resolve(root, 'vs') + path.sep)) continue;
        try {
          return new Response(readFileSync(target), { headers: { 'Content-Type': type } });
        } catch {}
      }
      return notFound();
    }

    if (file !== 'app/slick.js' && file !== 'slick.js') return notFound();

    for (const bundle of candidates) {
      try {
        return new Response(readFileSync(bundle), {
          headers: { 'Content-Type': 'application/javascript' },
        });
      } catch {}
    }
    console.error(`[slick] slick.js not found in any of: ${candidates.join(', ')}`);
    return new Response('console.error("[slick] bundle not found")', {
      headers: { 'Content-Type': 'application/javascript' },
    });
  });
}
