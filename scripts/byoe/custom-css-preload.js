'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL = 'slick-custom-css';
contextBridge.exposeInMainWorld('slickCustomCss', {
  ready: () => ipcRenderer.send(`${CHANNEL}:ready`),
  save: (css) => ipcRenderer.send(`${CHANNEL}:save`, css),
  onValue: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on(`${CHANNEL}:value`, listener);
  },
});
