// Preload for the custom-CSS editor window.
//
// Wrapped in an IIFE so its `contextBridge`/`ipcRenderer` bindings stay out of
// the global scope: this and src/desktop/preload.ts are both CJS scripts
// rather than modules, so identical top-level names in the two would collide.

(() => {
  const { contextBridge, ipcRenderer } = require('electron');

  const CHANNEL = 'slick-custom-css';

  contextBridge.exposeInMainWorld('slickCustomCss', {
    ready: () => ipcRenderer.send(`${CHANNEL}:ready`),
    save: (css: string) => ipcRenderer.send(`${CHANNEL}:save`, css),
    onValue: (callback: (value: string) => void) => {
      const listener = (_event: unknown, value: unknown) => {
        if (typeof value === 'string') callback(value);
      };
      ipcRenderer.on(`${CHANNEL}:value`, listener);
    },
  });
})();
