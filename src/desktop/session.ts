// Serves the embedded slick.js (and the CSS editor) over slick://.
// SLICK_APP_URL is a dev-only override for `npm run dev`.

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
      // Custom schemes get no V8 code cache unless opted in.
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true },
    },
  ];
}

export function appUrl(): string {
  return process.env.SLICK_APP_URL || 'slick://app/slick.js';
}

/** The only file types served from the Monaco dir. */
const MONACO_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const notFound = () => new Response('Not found', { status: 404 });

/**
 * `dirs` are searched in order: Slick's own resources (captured before patch.ts
 * spoofs `resourcesPath`) when packaged, next to main.js in dev.
 */
export function setupSession(dirs: string[]) {
  const candidates = dirs.map((dir) => path.join(dir, 'slick.js'));
  const monacoDirs = dirs.map((dir) => path.join(dir, 'monaco'));

  session.defaultSession.protocol.handle(SLICK_SCHEME, (request) => {
    const url = new URL(request.url);
    const file = url.pathname.replace(/^\//, '');

    // Custom-CSS editor; HTML is generated so the Monaco URL lives in one place.
    if (url.hostname === 'editor') {
      if (file === '' || file === 'index.html') {
        return new Response(editorHtml(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      const prefix = MONACO_URL_PREFIX.replace(/^\//, '');
      if (!file.startsWith(prefix)) return notFound();

      // Re-checked against the root below so `..` can't escape it.
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
