// Serves the deferred slick.js runtime over slick:// via C++ protocol.registerSource
// (off-main-thread, code-cached, bypassing Slack's <meta> CSP) and serves the
// standalone CSS editor over slick-editor://. SLICK_APP_URL is a dev override.

import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { session } from 'electron';
import { createAssetReader } from './assetReader.ts';
import { EDITOR_SCHEME, editorHtml, MONACO_URL_PREFIX } from './windows/cssEditor.ts';

export const SLICK_SCHEME = 'slick';

/** Must be called before app is ready. */
export function privilegedSchemes(): Electron.CustomScheme[] {
  return [
    {
      scheme: SLICK_SCHEME,
      // Custom schemes get no V8 code cache unless opted in.
      privileges: {
        standard: true,
        secure: true,
        bypassCSP: true,
        supportFetchAPI: true,
        corsEnabled: true,
        codeCache: true,
      },
    },
    {
      scheme: EDITOR_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ];
}

let bundleCandidates: string[] = [];

export function appUrl(): string {
  if (process.env.SLICK_APP_URL) return process.env.SLICK_APP_URL;
  for (const bundle of bundleCandidates) {
    try {
      return `slick://app/slick.js?v=${Math.trunc(statSync(bundle).mtimeMs)}`;
    } catch {}
  }
  return 'slick://app/slick.js';
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
const js = (body: string) => new Response(body, { headers: { 'Content-Type': 'application/javascript' } });

/**
 * `dirs` are searched in order: Slick's own resources (captured before patch.ts
 * spoofs `resourcesPath`) when packaged, next to main.js in dev.
 */
export function setupSession(dirs: string[], preloadPath?: string) {
  const candidates = dirs.map((dir) => path.join(dir, 'slick.js'));
  bundleCandidates = candidates;
  const monacoDirs = dirs.map((dir) => path.join(dir, 'monaco'));
  const readAsset = createAssetReader(false);

  if (preloadPath) {
    session.defaultSession.registerPreloadScript({
      type: 'frame',
      filePath: preloadPath,
      matches: ['https://app.slack.com/*', 'https://slack.com/*', 'https://*.slack.com/*'],
    });
  }

  const bundleDir = dirs.find((dir) => existsSync(path.join(dir, 'slick.js')));
  if (bundleDir) {
    const routes: Electron.ProtocolRoute[] = [];
    if (process.env.SLICK_HOT && dirs.length) {
      const hotDir = path.join(dirs[dirs.length - 1]!, 'hot');
      mkdirSync(hotDir, { recursive: true });
      routes.push({ match: { host: 'app', path: '/hot/' }, source: { type: 'directory', root: hotDir, index: '' } });
    }
    routes.push({ match: { host: 'app', path: '/' }, source: { type: 'directory', root: bundleDir, index: '' } });
    session.defaultSession.protocol.registerSource(SLICK_SCHEME, { routes });
  } else {
    session.defaultSession.protocol.handle(SLICK_SCHEME, () => {
      console.error(`[slick] slick.js not found in any of: ${candidates.join(', ')}`);
      return js('console.error("[slick] bundle not found")');
    });
  }

  session.defaultSession.protocol.handle(EDITOR_SCHEME, async (request) => {
    const url = new URL(request.url);
    const file = url.pathname.replace(/^\//, '');

    if (url.hostname !== 'editor') return notFound();
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
        return new Response(await readAsset(target), { headers: { 'Content-Type': type } });
      } catch {}
    }
    return notFound();
  });
}
