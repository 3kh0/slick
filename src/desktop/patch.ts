// Slick Desktop Patch
// Mutates the cached CJS electron module *before* Slack's asar is required, so
// every subsequent require('electron') from Slack's own code sees our versions.
// Also spoofs the process/app properties Slack uses to locate its assets.
//
// This replaces the per-platform patching that v1 duplicated across
// scripts/byoe/build-handoff-app{,-win,-linux}.js and scripts/byoe/inject.js.

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { app, ipcMain, Menu, shell } from 'electron';
import { profileDir } from './paths.js';

const cjsRequire = createRequire(import.meta.url);
const NodeModule = cjsRequire('module') as any;
const electronCjs = cjsRequire('electron') as Record<string, any>;

// Every require('electron') from Slack resolves to this proxy, so an entry in
// `overrides` shadows the real export without mutating the electron module.
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

// Slack must never update the bundle we are running out of; v1 stubbed this in
// scripts/byoe/inject.js. Slick's own updater handles Slack (slackUpdater.ts).
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

// Menu

let openSettings: (() => void) | null = null;
let checkForUpdates: (() => void) | null = null;

export function setMenuHandlers(handlers: { openSettings?: () => void; checkForUpdates?: () => void }) {
  if (handlers.openSettings) openSettings = handlers.openSettings;
  if (handlers.checkForUpdates) checkForUpdates = handlers.checkForUpdates;
}

function slickMenuTemplate(): Electron.MenuItemConstructorOptions {
  const submenu: Electron.MenuItemConstructorOptions[] = [
    { label: 'About Slick', click: () => app.showAboutPanel() },
    { label: 'Slick Settings…', click: () => openSettings?.() },
  ];
  if (checkForUpdates) submenu.push({ label: 'Check for Updates…', click: () => checkForUpdates?.() });
  submenu.push(
    { type: 'separator' },
    { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Alt+I' },
    { role: 'reload' },
    { role: 'forceReload' },
    { type: 'separator' },
    { role: 'quit' },
  );
  return { label: 'Slick', submenu };
}

// v1 only patched the menu on macOS (inside build-handoff-app.js); doing it
// here gets it on Windows and Linux too.
function injectSlickMenu(items: (Electron.MenuItem | Electron.MenuItemConstructorOptions)[]) {
  const out = [...items];
  if (out.some((item) => (item as Electron.MenuItem).label === 'Slick')) return out;
  const helpIndex = out.findIndex((item) => (item as Electron.MenuItem).role === 'help');
  if (helpIndex === -1) out.push(slickMenuTemplate());
  else out.splice(helpIndex, 0, slickMenuTemplate());
  return out;
}

// Patches

export function applyPatches(
  slackAsarPath: string,
  slickPreloadPath: string,
  onWindow?: (window: Electron.BrowserWindow) => void,
) {
  const slackResources = path.dirname(slackAsarPath);

  // The preload we substitute has to be able to run Slack's original one, or
  // Slack's contextBridge surface never appears. See preload.ts.
  const originalPreloads = new Map<string, string>();
  ipcMain.handle('slick:get-original-preload', (_event, key: string) => originalPreloads.get(key) ?? null);

  /**
   * Swap Slack's preload for ours and keep its source fetchable by key.
   *
   * A window whose preload cannot be read keeps Slack's own path: substituting
   * ours with no source to evaluate would strand the renderer without the
   * desktop API it expects.
   */
  function substitutePreload(webPreferences: any = {}): { webPreferences: any; preloadKey: string } {
    const slackPreload: string | undefined = webPreferences?.preload;
    let originalPreload: string | null = null;
    if (slackPreload) {
      try {
        originalPreload = readFileSync(slackPreload, 'utf8');
        if (!originalPreload.trim()) throw new Error('preload is empty');
      } catch (error) {
        console.error('[slick] could not read Slack preload:', error);
      }
    }
    const preloadKey = originalPreload ? crypto.randomUUID() : '';
    if (preloadKey) originalPreloads.set(preloadKey, originalPreload as string);
    return {
      preloadKey,
      webPreferences: {
        ...webPreferences,
        preload: preloadKey ? slickPreloadPath : slackPreload,
        additionalArguments: preloadKey
          ? [...(webPreferences?.additionalArguments ?? []), `--slick-preload-key=${preloadKey}`]
          : webPreferences?.additionalArguments,
        devTools: true,
      },
    };
  }

  const OrigBrowserWindow = electronCjs.BrowserWindow;
  overrides.BrowserWindow = new Proxy(OrigBrowserWindow, {
    construct(Target: any, [opts = {}]: any[]) {
      const { webPreferences, preloadKey } = substitutePreload(opts.webPreferences);
      const window = new Target({ ...opts, webPreferences });
      if (preloadKey) window.once('closed', () => originalPreloads.delete(preloadKey));
      try {
        onWindow?.(window);
      } catch (error) {
        console.error('[slick] window hook failed:', error);
      }
      return window;
    },
  });

  // Windows Slack opens with window.open -- popped-out conversations, the
  // in-app browser, anything ctrl/cmd-clicked -- never reach the proxy above.
  // Slack answers them from setWindowOpenHandler, and Electron builds the
  // guest WebContents from `overrideBrowserWindowOptions` internally, before
  // any BrowserWindow wrapper exists. Without this they run stock Slack: no
  // bridge, no plugins, and no theme, which is exactly how they used to look.
  app.on('web-contents-created', (_event, contents) => {
    const originalSetter = contents.setWindowOpenHandler.bind(contents);
    contents.setWindowOpenHandler = (handler: (details: Electron.HandlerDetails) => any) =>
      originalSetter((details) => {
        let result: any;
        try {
          result = handler(details);
        } catch (error) {
          // Slack's own decision must stand even if it threw; denying here
          // would silently stop links opening at all.
          console.error('[slick] Slack window-open handler threw:', error);
          throw error;
        }
        if (result?.action !== 'allow') return result;

        const { webPreferences, preloadKey } = substitutePreload(result.overrideBrowserWindowOptions?.webPreferences);
        if (preloadKey) {
          // The next window this contents creates is the one just allowed.
          contents.once('did-create-window', (window: Electron.BrowserWindow) => {
            window.once('closed', () => originalPreloads.delete(preloadKey));
            try {
              onWindow?.(window);
            } catch (error) {
              console.error('[slick] window hook failed:', error);
            }
          });
        }
        return {
          ...result,
          overrideBrowserWindowOptions: { ...result.overrideBrowserWindowOptions, webPreferences },
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

  app.setAboutPanelOptions({
    applicationName: 'Slick',
    applicationVersion: typeof __SLICK_VERSION__ === 'string' ? __SLICK_VERSION__ : 'dev',
    website: 'https://github.com/3kh0/slick',
  });

  // Make Slack believe it is running out of its own bundle. This is the
  // load-bearing trick v1 also relied on; without it Slack cannot find its
  // assets, and its own preload path resolution breaks.
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: slackResources });
  app.getAppPath = () => slackAsarPath;
  app.setPath('userData', profileDir());

  return { openExternal: (url: string) => shell.openExternal(url) };
}
