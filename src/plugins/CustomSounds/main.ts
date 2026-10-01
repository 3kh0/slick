// Serves the configured sound over a privileged scheme. The `p` parameter only
// busts the media cache on a settings change; it is checked against the
// configured path, never trusted, or page script could read any file.

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { SlickMainPlugin } from '$slick';
import { macSoundsDirectory } from '../../desktop/macNotificationSounds.ts';
import { expandSoundPath, overrideNativeSound, prepareNativeSound } from './native.ts';

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

const expand = expandSoundPath;
const notFound = () => new Response('', { status: 404 });

const plugin: SlickMainPlugin = {
  id: 'CustomSounds',
  capabilities: ['protocol', 'notifications'],

  async ready(ctx) {
    if (process.platform !== 'darwin') return;
    let sound: string | null = null;
    let generation = 0;
    const refresh = async () => {
      const current = ++generation;
      sound = null;
      const configured = expand(String(ctx.settings.soundPath ?? ''));
      if (!configured) return;
      try {
        const prepared = await prepareNativeSound(configured, macSoundsDirectory());
        if (current === generation) sound = prepared;
      } catch (error) {
        ctx.log('could not prepare native notification sound', error);
      }
    };
    await refresh();
    const unsubscribe = ctx.onSettingsChange(() => void refresh());
    const removeFilter = ctx.notifications.filter((options) => {
      overrideNativeSound(options, sound);
      return true;
    });
    return () => {
      ++generation;
      sound = null;
      unsubscribe();
      removeFilter();
    };
  },

  boot(ctx) {
    ctx.protocol.register(SCHEME, { standard: true, secure: true, stream: true }, (request) => {
      const configured = expand(String(ctx.settings.soundPath ?? ''));
      if (!configured) return notFound();

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
