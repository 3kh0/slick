const isClient = (window: Electron.BrowserWindow) => {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return false;
  try {
    const url = new URL(window.webContents.getURL());
    return url.origin === 'https://app.slack.com' && /^\/client(\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
};

// Slack's huddle overlays are hidden, transparent about:blank windows; showing one leaves an invisible click blocker.
const isNavigated = (window: Electron.BrowserWindow) => {
  if (window.isDestroyed() || window.webContents.isDestroyed() || !window.isFocusable()) return false;
  const url = window.webContents.getURL();
  return url !== '' && url !== 'about:blank';
};

function surface(window: Electron.BrowserWindow) {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export function openSettings(windows: Electron.BrowserWindow[], focused: Electron.BrowserWindow | null): boolean {
  const window = focused && isClient(focused) ? focused : windows.find(isClient);
  if (!window) return false;
  surface(window);
  window.webContents.send('slick:open-settings');
  return true;
}

export function focusClientWindow(windows: Electron.BrowserWindow[]): boolean {
  const window = windows.find(isClient) ?? windows.find(isNavigated);
  if (!window) return false;
  surface(window);
  return true;
}
