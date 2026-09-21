// CustomSounds, main-process half.
//
// Serves the chosen audio file over a privileged scheme, for the same reason
// CustomFonts does: the page cannot read a local path.
//
// The handler only ever serves the file named in settings. The `p` parameter
// exists so a settings change busts the media cache, and is checked against
// the configured path rather than trusted -- otherwise page script could ask
// for any file on disk.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { SlickMainPlugin } from '$slick';

const SCHEME = 'slick-custom-sounds';

const MIME: Record<string, string> = {
  '.aac': 'audio/aac',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.caf': 'audio/x-caf',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
};

const expand = (value: string) => value.replace(/^~(?=[/\\]|$)/, os.homedir()).trim();
const notFound = () => new Response('', { status: 404 });

const plugin: SlickMainPlugin = {
  id: 'CustomSounds',
  capabilities: ['protocol'],

  boot(ctx) {
    ctx.protocol.register(SCHEME, { standard: true, secure: true, stream: true }, (request) => {
      const configured = expand(String(ctx.settings.soundPath ?? ''));
      if (!configured) return notFound();

      // The requested path must be the configured one. Page script controls
      // the URL, so anything else would be an arbitrary file read.
      let requested: string;
      try {
        requested = expand(new URL(request.url).searchParams.get('p') ?? '');
      } catch {
        return notFound();
      }
      if (requested && requested !== configured) return notFound();

      try {
        if (!fs.statSync(configured).isFile()) return notFound();
        const type = MIME[path.extname(configured).toLowerCase()] ?? 'application/octet-stream';
        return new Response(Readable.toWeb(fs.createReadStream(configured)) as unknown as ReadableStream, {
          headers: { 'content-type': type },
        });
      } catch {
        return notFound();
      }
    });
  },
};

export default plugin;
