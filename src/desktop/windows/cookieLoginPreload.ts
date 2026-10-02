(() => {
  const { contextBridge, ipcRenderer } = require('electron');
  contextBridge.exposeInMainWorld('slickCookieLogin', {
    submit: (value: string) => ipcRenderer.invoke('slick:cookie-login', value),
  });
})();
