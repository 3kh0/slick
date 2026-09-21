// CustomFonts, main-process half.
//
// Serves an uploaded font file over a privileged scheme. The page cannot read
// a local path itself, and inlining the font as a data URI would mean
// re-parsing ~1MB of base64 on every settings change.
//
// The handler is the security boundary: page script controls the `path`
// parameter, so it must not become a way to read arbitrary files. Two rules do
// that -- the extension must be a known font type, and the target must be a
// regular file. A font file is also only ever returned with a font content
// type, so a readable path that is not a font cannot be exfiltrated as text.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { SlickMainPlugin } from '$slick';

const SCHEME = 'slick-custom-font';

const MIME: Record<string, string> = {
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const notFound = () => new Response('', { status: 404 });

const plugin: SlickMainPlugin = {
  id: 'CustomFonts',
  capabilities: ['protocol'],

  // Privileged schemes have to be declared before the app is ready.
  boot(ctx) {
    ctx.protocol.register(
      SCHEME,
      { standard: true, secure: true, stream: true, corsEnabled: true, supportFetchAPI: true },
      (request) => {
        let requested: string;
        try {
          requested = new URL(request.url).searchParams.get('path') ?? '';
        } catch {
          return notFound();
        }

        // `~` is what the settings file stores for a path under home.
        const file = requested.replace(/^~(?=[/\\]|$)/, os.homedir()).trim();
        if (!file) return notFound();

        const extension = path.extname(file).toLowerCase();
        if (!Object.hasOwn(MIME, extension)) return notFound();

        try {
          if (!fs.statSync(file).isFile()) return notFound();
          return new Response(Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream, {
            headers: { 'access-control-allow-origin': '*', 'content-type': MIME[extension] },
          });
        } catch {
          return notFound();
        }
      },
    );
  },
};

export default plugin;
