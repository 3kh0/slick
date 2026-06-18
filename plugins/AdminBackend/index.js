'use strict';

const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'AdminBackend',
    description: 'Open profiles in Hack Club admin tools',
  },
  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
  main(ctx) {
    const s = ctx.electron && ctx.electron.shell;
    if (!s || typeof s.openExternal !== 'function') return;
    ctx.onWindow((win) => {
      win.webContents.on('will-navigate', (event, url) => {
        let u;
        try {
          u = new URL(url);
        } catch {
          return;
        }
        if (u.protocol !== 'https:' || u.hostname !== 'slick.admin-backend' || u.port || u.pathname !== '/open') return;
        const id = u.searchParams.get('id') || '';
        if (!/^[UW][A-Z0-9]{6,}$/.test(id)) return;
        const target = u.searchParams.get('target');
        const e =
          target === 'identity'
            ? `https://auth.hackclub.com/backend/identities?search=${encodeURIComponent(id)}`
            : target === 'joe'
              ? `https://joe.fraud.hackclub.com/profile/${encodeURIComponent(id)}`
              : null;
        if (!e) return;
        event.preventDefault();
        s.openExternal(e).catch((error) => ctx.log(`could not open ${e}: ${error.message}`));
      });
    });
  },
};
