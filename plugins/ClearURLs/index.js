'use strict';
const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'ClearURLs',
    description: 'Automatically removes tracking elements from URLs you send',
  },

  settings: {
    extraRules: {
      type: 'text',
      label: 'Extra rules',
      description: 'Comma-separated additional rules: "param" or "param@host" ("*" wildcards allowed)',
      default: '',
    },
  },

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),

  main(ctx) {
    const net = ctx.electron && ctx.electron.net;
    const doFetch = net && net.fetch ? net.fetch.bind(net) : fetch;
    const rules = ctx.app.whenReady().then(async () => {
      const cache = path.join(ctx.app.getPath('userData'), 'slick', 'clearurls-rules.json');
      let cached = null;
      try {
        cached = JSON.parse(fs.readFileSync(cache, 'utf8'));
      } catch (e) {}
      try {
        const res = await doFetch('https://raw.githubusercontent.com/ClearURLs/Rules/master/data.min.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!data || typeof data.providers !== 'object') throw new Error('unexpected payload');
        try {
          fs.mkdirSync(path.dirname(cache), { recursive: true });
          fs.writeFileSync(cache, JSON.stringify(data));
        } catch (e) {}
        ctx.log(`fetched ${Object.keys(data.providers).length} providers`);
        return data;
      } catch (e) {
        ctx.log(`rules fetch failed (${e.message}), ${cached ? 'using cached copy' : 'no cache — extra rules only'}`);
        return cached;
      }
    });

    ctx.onWindow((win) => {
      const wc = win.webContents;
      const push = () =>
        rules.then((d) => {
          if (!d || wc.isDestroyed()) return;
          wc.executeJavaScript(
            `window.__slickClearURLsData = ${JSON.stringify(d)};` +
              `window.dispatchEvent(new CustomEvent('slick:clearurls-rules')); true`,
            true,
          ).catch(() => {});
        });
      wc.on('dom-ready', push);
      push();
    });
  },
};
