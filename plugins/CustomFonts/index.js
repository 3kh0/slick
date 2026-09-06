'use strict';

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const MIME = {
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

module.exports = {
  meta: {
    name: 'CustomFonts',
    description: 'Use any installed system font or upload your own font file.',
  },

  // Early owns the system-font family. The renderer still loads so uploaded
  // font files (custom protocol) keep working on desktop.
  earlyCoexist: true,

  settings: {
    fontFamily: {
      type: 'text',
      label: 'System font',
      description: 'Choose from all installed fonts in Preferences > Appearance.',
      default: '',
    },
    fontPath: {
      type: 'file',
      label: 'Custom font file',
      description: 'A local TTF, OTF, WOFF, or WOFF2 file. This takes priority over the system font.',
      default: '',
      accept: '.ttf,.otf,.woff,.woff2',
    },
  },

  main(ctx) {
    try {
      ctx.electron.protocol.registerSchemesAsPrivileged([
        {
          scheme: 'slick-custom-font',
          privileges: { standard: true, secure: true, stream: true, corsEnabled: true, supportFetchAPI: true },
        },
      ]);
    } catch {}

    ctx.app.whenReady().then(() =>
      ctx.electron.protocol.handle('slick-custom-font', (request) => {
        const raw = new URL(request.url).searchParams.get('path') || '';
        const file = raw.replace(/^~(?=\/|$)/, ctx.app.getPath('home')).trim();
        const ext = path.extname(file).toLowerCase();
        try {
          if (!MIME[ext] || !fs.statSync(file).isFile()) return new Response('', { status: 404 });
          return new Response(Readable.toWeb(fs.createReadStream(file)), {
            headers: { 'access-control-allow-origin': '*', 'content-type': MIME[ext] },
          });
        } catch {
          return new Response('', { status: 404 });
        }
      }),
    );
  },

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
