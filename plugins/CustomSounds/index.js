'use strict';

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const exts = {
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

module.exports = {
  meta: {
    name: 'CustomSounds',
    description: 'Override Slack notification sounds with your own audio file.',
  },

  settings: {
    enabled: {
      type: 'boolean',
      label: 'Override sounds',
      description: 'Play the selected sound for Slack notifications',
      default: true,
    },
    soundPath: {
      type: 'file',
      label: 'Sound file',
      description: 'Local audio file to play for notifications',
      default: '',
      accept: 'audio/*,.aac,.aif,.aiff,.caf,.flac,.m4a,.mp3,.oga,.ogg,.opus,.wav,.webm',
    },
  },

  main(ctx) {
    const file = (u) => {
      const raw = new URL(u).searchParams.get('p') || ctx.settings.soundPath || '';
      const p = String(raw)
        .replace(/^~(?=\/|$)/, ctx.app.getPath('home'))
        .trim();
      try {
        return p && fs.statSync(p).isFile() ? p : '';
      } catch {
        return '';
      }
    };

    try {
      ctx.electron.protocol.registerSchemesAsPrivileged([
        { scheme: 'slick-custom-sounds', privileges: { standard: true, secure: true, stream: true } },
      ]);
    } catch {}

    ctx.app.whenReady().then(() =>
      ctx.electron.protocol.handle('slick-custom-sounds', (req) => {
        const p = file(req.url);
        return p
          ? new Response(Readable.toWeb(fs.createReadStream(p)), {
              headers: { 'content-type': exts[path.extname(p).toLowerCase()] || 'application/octet-stream' },
            })
          : new Response('', { status: 404 });
      }),
    );
  },

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
