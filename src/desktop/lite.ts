// Lite mode: Slack's web client in Slick's own window, without Slack's app.asar.
// The web client sees plain Chromium and takes its browser path, so it never
// looks for Slack's window.desktop bridge. No Slack install, no Electron major
// lockstep, and none of Slack's main-process startup work.

import path from 'node:path';
import { app, BrowserWindow, desktopCapturer, Menu, session, shell } from 'electron';
import { configDir } from './paths.js';
import { slickMenuTemplate } from './patch.js';
import { badgeFromTitle, isSlackUrl, isSsoUrl, LITE_ARG, liteUserAgent } from './liteMode.ts';

export { liteRequested } from './liteMode.ts';

const START_URL = 'https://app.slack.com/client';
const ALLOWED_PERMISSIONS = new Set([
  'notifications',
  'media',
  'clipboard-sanitized-write',
  'fullscreen',
  'display-capture',
]);

type LiteOptions = {
  preload: string;
  onWindow?: (window: BrowserWindow) => void;
  onSignIn?: (contents: Electron.WebContents, url: string) => boolean;
};

/** Before app-ready: a separate profile, and the user agent every window inherits. */
export function prepareLite() {
  app.setPath('userData', path.join(configDir(), 'lite-profile'));
  app.userAgentFallback = liteUserAgent(app.userAgentFallback);
}

function windowOptions(preload: string): Electron.BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 800,
    title: 'Slack',
    backgroundColor: '#1a1d21',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload,
      contextIsolation: true,
      spellcheck: true,
      additionalArguments: [LITE_ARG],
      devTools: true,
    },
  };
}

function applyBadge(title: string) {
  const count = badgeFromTitle(title);
  app.setBadgeCount(count);
  if (process.platform === 'darwin') app.dock?.setBadge(count ? String(count) : '');
}

function setLiteMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    slickMenuTemplate(),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** After app-ready. */
export function startLite({ preload, onWindow, onSignIn }: LiteOptions) {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && !!contents && isSlackUrl(contents.getURL()));
  });

  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: true },
  );

  setLiteMenu();

  const wire = (window: BrowserWindow) => {
    window.webContents.on('page-title-updated', (_event, title) => applyBadge(title));
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (onSignIn?.(window.webContents, url)) return { action: 'deny' };
      if (isSlackUrl(url) || isSsoUrl(url)) {
        return { action: 'allow', overrideBrowserWindowOptions: windowOptions(preload) };
      }
      if (/^(https?|mailto):/.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('did-create-window', (child) => wire(child));
    try {
      onWindow?.(window);
    } catch (error) {
      console.error('[slick] window hook failed:', error);
    }
  };

  const open = () => {
    const window = new BrowserWindow(windowOptions(preload));
    wire(window);
    void window.loadURL(START_URL);
    return window;
  };

  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) open();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  return open();
}
