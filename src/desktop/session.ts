// Slick Desktop Session
// Serves the app bundle over the privileged slick:// scheme.
//
// Slick is embedded-only: slick.js ships inside the app's resources and is
// never fetched from a CDN. SLICK_APP_URL exists so `npm run dev` can point the
// loader at a local dev server; it is a development escape hatch, not a feature.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { session } from 'electron';

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

/** `resourcesPath` must be Slick's own, captured before patch.ts spoofs it. */
export function setupSession(slickResourcesPath: string) {
  const bundle = path.join(slickResourcesPath, 'slick.js');

  session.defaultSession.protocol.handle(SLICK_SCHEME, (request) => {
    const file = new URL(request.url).pathname.replace(/^\//, '');
    if (file !== 'app/slick.js' && file !== 'slick.js') {
      return new Response('Not found', { status: 404 });
    }
    try {
      return new Response(readFileSync(bundle), {
        headers: { 'Content-Type': 'application/javascript' },
      });
    } catch (error) {
      console.error('[slick] slick.js missing from resources:', error);
      return new Response('console.error("[slick] bundle not found")', {
        headers: { 'Content-Type': 'application/javascript' },
      });
    }
  });
}
