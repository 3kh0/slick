// IIFE: this and preload.ts are both CJS scripts, so shared top-level names
// would collide in the global scope.

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
