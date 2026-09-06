'use strict';

const fs = require('node:fs');
const path = require('node:path');
const bundle = require('../../runtime/bundle');
const settingsAdapter = require('../byoe/early-settings');

const output = path.resolve(__dirname, '../../dist/early-extension');
fs.mkdirSync(output, { recursive: true });
const source = bundle.source();
fs.writeFileSync(path.join(output, 'main.js'), source);
// Data-only plugin metadata for the extension options page. The options page
// runs in the extension world and never loads the runtime bundle itself.
fs.writeFileSync(
  path.join(output, 'plugins-meta.js'),
  `globalThis.SLICK_EARLY_PLUGINS = ${JSON.stringify(bundle.metadata(), null, 2)};\n`,
);
fs.writeFileSync(
  path.join(output, 'desktop-preload.cjs'),
  `const { contextBridge, ipcRenderer } = require('electron');
if (window.top === window && location.protocol === 'https:' && location.hostname === 'app.slack.com' && location.pathname.startsWith('/client/')) {
  try {
    const initial = ipcRenderer.sendSync('slick-beta-settings');
    if (initial && typeof contextBridge.executeInMainWorld === 'function') {
      contextBridge.exposeInMainWorld('__slickBetaSend', (request) => {
        if (request?.type === 'nickname' || request?.type === 'migrate-nicknames')
          return ipcRenderer.sendSync('slick-beta-settings', request);
      });
      contextBridge.executeInMainWorld({ func: function (initial) {
        ${source}
        (${settingsAdapter.toString()})(initial, window.__slickBetaSend);
      }, args: [initial] });
      ipcRenderer.on('slick-beta-settings', (_event, state) => {
        try { contextBridge.executeInMainWorld({ func: function (state) {
          window.__slickDesktopEarly?.update(state);
        }, args: [state] }); } catch {}
      });
    }
  } catch (error) { console.error('[slick-beta] preload failed:', error.message); }
}
`,
);
const extension = path.resolve(__dirname, '../../extension');
for (const name of fs.readdirSync(extension)) fs.copyFileSync(path.join(extension, name), path.join(output, name));
console.log(`Built ${Buffer.byteLength(source)} byte shared runtime (${bundle.registry.length} plugins) at ${output}`);
