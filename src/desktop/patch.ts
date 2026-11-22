// Must run before Slack's asar is required: every require('electron') from
// Slack then sees our overrides. Also spoofs the process/app paths Slack uses to
// find its assets.

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { app, Menu, MenuItem, shell } from 'electron';
import { profileDir } from './paths.js';
import { trayDir, wrapTray } from './trayIcons.js';
import { wrapMacNotifications } from './macNotificationSounds.js';
import { relabelAppMenu } from './menuLabels.ts';
import { popupOptions } from './popupOptions.ts';
import { claimFlatpakScheme } from './flatpakHandler.ts';
import { installSchemeMerger } from './privilegedSchemes.ts';

const cjsRequire = createRequire(import.meta.url);
const NodeModule = cjsRequire('module') as any;
const electronCjs = cjsRequire('electron') as Record<string, any>;
installSchemeMerger(electronCjs.protocol);

// `overrides` shadow real exports without mutating the electron module.
const overrides: Record<string, any> = {};
const electronProxy = new Proxy(electronCjs, {
  get(target, prop: string) {
    return prop in overrides ? overrides[prop] : target[prop];
  },
});

const origModuleLoad = NodeModule._load;
NodeModule._load = function (request: string, ...args: any[]) {
  if (request === 'electron') return electronProxy;
  return origModuleLoad.call(this, request, ...args);
};

// Slack must never update the bundle we run from; slackUpdater.ts updates Slack.
class NoopAutoUpdater extends EventEmitter {
  setFeedURL() {}
  getFeedURL() {
    return '';
  }
  checkForUpdates() {
    this.emit('checking-for-update');
    process.nextTick(() => this.emit('update-not-available'));
  }
  quitAndInstall() {
    app.quit();
  }
}
overrides.autoUpdater = new NoopAutoUpdater();

overrides.crashReporter = {
  start() {},
  getLastCrashReport: () => null,
  getUploadedReports: () => [],
  getUploadToServer: () => false,
  setUploadToServer() {},
  addExtraParameter() {},
  removeExtraParameter() {},
  getParameters: () => ({}),
};

let openSettings: (() => void) | null = null;
let checkForUpdates: (() => void) | null = null;
let cookieLogin: (() => void) | null = null;

export function setMenuHandlers(handlers: {
  openSettings?: () => void;
  checkForUpdates?: () => void;
  cookieLogin?: () => void;
}) {
  if (handlers.openSettings) openSettings = handlers.openSettings;
  if (handlers.checkForUpdates) checkForUpdates = handlers.checkForUpdates;
  if (handlers.cookieLogin) cookieLogin = handlers.cookieLogin;
}

function slickMenuTemplate(): Electron.MenuItemConstructorOptions {
  const submenu: Electron.MenuItemConstructorOptions[] = [
    { label: 'About Slick', click: () => app.showAboutPanel() },
    { label: 'Slick Settings…', click: () => openSettings?.() },
  ];
  if (checkForUpdates) submenu.push({ label: 'Check for Updates…', click: () => checkForUpdates?.() });
  submenu.push({ label: 'Sign In with Cookies…', click: () => cookieLogin?.() });
  submenu.push(
    { type: 'separator' },
    { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Alt+I' },
    { role: 'reload' },
    { role: 'forceReload' },
    { type: 'separator' },
    { role: 'quit', label: 'Quit Slick' },
  );
  return { label: 'Slick', submenu };
}

type AnyItem = Electron.MenuItem | Electron.MenuItemConstructorOptions;
/** Slack's Windows labels carry access keys (`&Help`), and its Help item has no role. */
const labelled = (item: AnyItem, name: string) => (item.label ?? '').replace(/&/g, '') === name;
const isHelp = (item: AnyItem) => item.role === 'help' || labelled(item, 'Help');

function injectSlickMenu(items: AnyItem[]) {
  const out = [...items];
  relabelAppMenu(out);
  if (out.some((item) => item.label === 'Slick')) return out;
  const helpIndex = out.findIndex(isHelp);
  if (helpIndex === -1) out.push(slickMenuTemplate());
  else out.splice(helpIndex, 0, slickMenuTemplate());
  return out;
}

export function applyPatches(
  slackAsarPath: string,
  slickResources: string,
  onWindow?: (window: Electron.BrowserWindow) => void,
  onSignIn?: (contents: Electron.WebContents, url: string) => boolean,
) {
  const slackResources = path.dirname(slackAsarPath);
  const tray = trayDir(slickResources);
  overrides.Tray = wrapTray(electronCjs.Tray, tray);
  if (process.platform === 'darwin') {
    overrides.Notification = wrapMacNotifications(electronCjs.Notification, slickResources);
  }

  if (process.platform === 'linux' && process.env.FLATPAK_ID === 'dev.slick.Slick') {
    app.on('second-instance', () => console.log('[slick] Flatpak received second-instance handoff'));
    overrides.app = new Proxy(app, {
      get(target, prop: string) {
        // Flatpak installs resources/app without an asar; Slack otherwise skips its singleton lock.
        if (prop === 'isPackaged') return true;
        if (prop === 'requestSingleInstanceLock') {
          return (...args: Parameters<typeof app.requestSingleInstanceLock>) => {
            const acquired = target.requestSingleInstanceLock(...args);
            console.log(`[slick] Flatpak single-instance lock ${acquired ? 'acquired' : 'held by another process'}`);
            return acquired;
          };
        }
        if (prop === 'setAsDefaultProtocolClient') {
          return (scheme: string, ...args: any[]) =>
            scheme === 'slack' ? claimFlatpakScheme(scheme) : target.setAsDefaultProtocolClient(scheme, ...args);
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, prop, value) {
        return Reflect.set(target, prop, value, target);
      },
    });
  }

  const OrigBrowserWindow = electronCjs.BrowserWindow;
  overrides.BrowserWindow = new Proxy(OrigBrowserWindow, {
    construct(Target: any, [opts = {}]: any[]) {
      if (opts.transparent) return new Target(opts);
      const window = new Target({ ...opts, webPreferences: { ...opts.webPreferences, devTools: true } });
      try {
        onWindow?.(window);
      } catch (error) {
        console.error('[slick] window hook failed:', error);
      }
      return window;
    },
  });

  // window.open windows (pop-outs, in-app browser, ctrl/cmd-clicks) bypass the
  // proxy above: Electron builds them from `overrideBrowserWindowOptions`
  // internally. Track their creation so main plugins hook them too.
  app.on('web-contents-created', (_event, contents) => {
    const originalSetter = contents.setWindowOpenHandler.bind(contents);
    contents.setWindowOpenHandler = (handler: (details: Electron.HandlerDetails) => any) =>
      originalSetter((details) => {
        if (onSignIn?.(contents, details.url)) return { action: 'deny' };
        let result: any;
        try {
          result = handler(details);
        } catch (error) {
          // Rethrow rather than deny, or links silently stop opening.
          console.error('[slick] Slack window-open handler threw:', error);
          throw error;
        }
        // Leave overlays (huddle drawing, Slackbot Mini) exactly as Slack builds them.
        if (result?.action !== 'allow' || result.overrideBrowserWindowOptions?.transparent) return result;

        // The next window this contents creates is the one just allowed.
        contents.once('did-create-window', (window: Electron.BrowserWindow) => {
          try {
            onWindow?.(window);
          } catch (error) {
            console.error('[slick] window hook failed:', error);
          }
        });
        return {
          ...result,
          overrideBrowserWindowOptions: {
            ...result.overrideBrowserWindowOptions,
            ...popupOptions(details, process.platform),
            webPreferences: { ...result.overrideBrowserWindowOptions?.webPreferences, devTools: true },
          },
        };
      });
  });

  const origSetApplicationMenu = electronCjs.Menu.setApplicationMenu.bind(electronCjs.Menu);
  electronCjs.Menu.setApplicationMenu = (menu: Electron.Menu | null) => {
    if (!menu) return origSetApplicationMenu(menu);
    return origSetApplicationMenu(Menu.buildFromTemplate(injectSlickMenu(menu.items)));
  };

  const origSetMenu = OrigBrowserWindow.prototype.setMenu;
  OrigBrowserWindow.prototype.setMenu = function (this: Electron.BrowserWindow, menu: Electron.Menu | null) {
    if (!menu) return origSetMenu.call(this, menu);
    return origSetMenu.call(this, Menu.buildFromTemplate(injectSlickMenu(menu.items)));
  };

  // Windows Slack sets neither: its title-bar button pops up a freshly built
  // app menu. Only a menu shaped like the app menu is touched, never a context menu.
  const origPopup = Menu.prototype.popup;
  Menu.prototype.popup = function (this: Electron.Menu, options?: Electron.PopupOptions) {
    const items = this.items;
    if (items.some((item) => labelled(item, 'File')) && items.some(isHelp)) {
      relabelAppMenu(items);
      if (!items.some((i) => i.label === 'Slick')) {
        this.insert(items.findIndex(isHelp), new MenuItem(slickMenuTemplate()));
      }
    }
    return origPopup.call(this, options);
  };

  app.setAboutPanelOptions({
    applicationName: 'Slick',
    applicationVersion: typeof __SLICK_VERSION__ === 'string' ? __SLICK_VERSION__ : 'dev',
    website: 'https://github.com/3kh0/slick',
    ...(tray && process.platform !== 'darwin' ? { iconPath: path.join(tray, 'tile.png') } : {}),
  });

  // Make Slack believe it runs from its own bundle, or it can't find its assets
  // or resolve its preload.
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: slackResources });
  app.getAppPath = () => slackAsarPath;
  app.setPath('userData', profileDir());

  return { openExternal: (url: string) => shell.openExternal(url) };
}
