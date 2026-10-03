export function openSettings(windows: Electron.BrowserWindow[], focused: Electron.BrowserWindow | null): boolean {
  const isClient = (window: Electron.BrowserWindow) => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return false;
    try {
      const url = new URL(window.webContents.getURL());
      return url.origin === 'https://app.slack.com' && /^\/client(\/|$)/.test(url.pathname);
    } catch {
      return false;
    }
  };
  const window = focused && isClient(focused) ? focused : windows.find(isClient);
  if (!window) return false;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.webContents.send('slick:open-settings');
  return true;
}
