// Slick Plugin Host
//
// Runs the main-process halves of plugins and exposes their RPC to the
// matching renderer half. This is the piece Taut has no equivalent for: its
// bridge is a closed method table, whereas 13 of Slick's plugins need
// privileged Electron work of their own.
//
// The renderer never names a plugin id -- the plugin manager binds it -- so a
// plugin cannot reach another plugin's methods.

import { app, dialog, ipcMain, Notification, protocol, session, shell, webContents } from 'electron';
import type { Capability, MainCtx, ProtocolPrivileges, SlickMainPlugin } from '../shared/main.ts';
import { type PluginSettings, resolveSettings, type SettingsSchema } from '../shared/settings.ts';
import * as blobStore from './blobStore.js';
import { isSlackClient, safeMode } from './bridge.js';

type Registered = {
  plugin: SlickMainPlugin;
  ctx: MainCtx;
  schema: SettingsSchema;
  defaultEnabled: boolean;
  settings: PluginSettings;
  settingsListeners: Set<(settings: PluginSettings) => void>;
};

const registered = new Map<string, Registered>();
let booted = false;

// Shared interception points
//
// Several plugins want the same hook. Installing one patch with a list of
// participants avoids v1's bug where StreamerMode and ShutUpSlackbot each
// replaced Notification.prototype.show and the second silently won.

const notificationFilters = new Set<(options: Electron.NotificationConstructorOptions) => boolean>();
let notificationsPatched = false;

function installNotificationFilter() {
  if (notificationsPatched) return;
  notificationsPatched = true;

  const OriginalShow = Notification.prototype.show;
  Notification.prototype.show = function patchedShow(this: Electron.Notification) {
    for (const allow of notificationFilters) {
      let permitted = true;
      try {
        permitted = allow(this as unknown as Electron.NotificationConstructorOptions);
      } catch (error) {
        console.error('[slick] notification filter threw:', error);
      }
      if (!permitted) return;
    }
    return OriginalShow.call(this);
  };
}

const frameListeners = new Set<(frame: Electron.WebFrameMain, contents: Electron.WebContents) => void>();
let framesPatched = false;

function installFrameWatcher() {
  if (framesPatched) return;
  framesPatched = true;

  app.on('web-contents-created', (_event, contents) => {
    contents.on('frame-created', (_e, { frame }) => {
      if (!frame) return;
      for (const listener of frameListeners) {
        try {
          listener(frame, contents);
        } catch (error) {
          console.error('[slick] frame listener threw:', error);
        }
      }
    });
  });
}

let displayMediaHandler: ((request: any) => any) | null = null;

// Context

function requireCapability(plugin: SlickMainPlugin, capability: Capability) {
  if (plugin.capabilities?.includes(capability)) return;
  throw new Error(`[slick] ${plugin.id} used "${capability}" without declaring it`);
}

function createCtx(plugin: SlickMainPlugin, entry: () => Registered): MainCtx {
  const id = plugin.id;
  const namespace = `plugin:${id}`;
  const need = (capability: Capability) => requireCapability(plugin, capability);

  return {
    id,
    get settings() {
      return entry().settings;
    },
    onSettingsChange(cb) {
      const listeners = entry().settingsListeners;
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    log: (...args) => console.log(`[slick] [${id}]`, ...args),

    emit(event, payload) {
      for (const contents of webContents.getAllWebContents()) {
        if (contents.isDestroyed() || !isSlackClient(contents.mainFrame)) continue;
        try {
          contents.send('slick:plugin-event', id, event, payload);
        } catch {}
      }
    },
    emitTo(contents, event, payload) {
      if (!contents.isDestroyed()) contents.send('slick:plugin-event', id, event, payload);
    },

    storage: {
      list: () => blobStore.list(namespace),
      read: (key) => blobStore.read(namespace, key),
      write: (key, value) => blobStore.write(namespace, key, value),
      delete: (key) => blobStore.remove(namespace, key),
      clear: () => blobStore.clear(namespace),
    },

    protocol: {
      register(scheme: string, privileges: ProtocolPrivileges, handler) {
        need('protocol');
        if (!booted) {
          protocol.registerSchemesAsPrivileged([{ scheme, privileges }]);
          return;
        }
        session.defaultSession.protocol.handle(scheme, (request) => handler(request));
      },
    },

    net: {
      block(patterns) {
        need('requests');
        const filter = { urls: patterns };
        session.defaultSession.webRequest.onBeforeRequest(filter, (_details, callback) => callback({ cancel: true }));
        return () => session.defaultSession.webRequest.onBeforeRequest(filter, (_d, cb) => cb({}));
      },
      intercept(patterns, handler) {
        need('requests');
        const filter = { urls: patterns };
        session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
          try {
            callback(handler(details) ?? {});
          } catch (error) {
            console.error(`[slick] ${id} request handler threw:`, error);
            callback({});
          }
        });
        return () => session.defaultSession.webRequest.onBeforeRequest(filter, (_d, cb) => cb({}));
      },
      async fetch(url, init) {
        need('net');
        const response = await fetch(url, init);
        return { status: response.status, body: await response.text() };
      },
    },

    frames: {
      onFrame(cb) {
        need('frames');
        installFrameWatcher();
        frameListeners.add(cb);
        return () => void frameListeners.delete(cb);
      },
    },

    notifications: {
      filter(predicate) {
        need('notifications');
        installNotificationFilter();
        notificationFilters.add(predicate);
        return () => void notificationFilters.delete(predicate);
      },
    },

    media: {
      onDisplayMediaRequest(handler) {
        need('media');
        displayMediaHandler = handler;
        session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
          try {
            callback(displayMediaHandler?.(request));
          } catch (error) {
            console.error(`[slick] ${id} display media handler threw:`, error);
            callback({});
          }
        });
        return () => {
          displayMediaHandler = null;
        };
      },
    },

    switches: {
      append(name, value) {
        need('switches');
        if (booted) throw new Error(`[slick] ${id}: switches can only be set during boot`);
        app.commandLine.appendSwitch(name, value);
      },
    },

    shell: {
      openExternal(url) {
        need('shell');
        const parsed = new URL(url);
        // Only ever hand the OS an http(s) URL: file:// and custom schemes are
        // how an openExternal turns into arbitrary local execution.
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          throw new Error(`[slick] ${id}: refusing to open ${parsed.protocol} externally`);
        }
        return shell.openExternal(parsed.href);
      },
    },

    dialog: {
      async openFile(options) {
        need('dialog');
        const result = await dialog.showOpenDialog({ properties: ['openFile'], ...options });
        return result.canceled ? '' : (result.filePaths[0] ?? '');
      },
    },
  } as MainCtx;
}

// Registration

export type PluginMeta = Record<string, { schema: SettingsSchema; defaultEnabled: boolean }>;

export function registerMainPlugins(plugins: SlickMainPlugin[], meta: PluginMeta) {
  for (const plugin of plugins) {
    if (!plugin?.id || registered.has(plugin.id)) continue;

    const schema = (meta[plugin.id]?.schema ?? {}) as SettingsSchema;
    const defaultEnabled = meta[plugin.id]?.defaultEnabled === true;
    const entry = {
      plugin,
      schema,
      defaultEnabled,
      settingsListeners: new Set<(settings: PluginSettings) => void>(),
      settings: resolveSettings(schema, defaultEnabled, undefined),
    } as Registered;

    entry.ctx = createCtx(plugin, () => entry);
    registered.set(plugin.id, entry);
  }
}

/**
 * Called before app.whenReady(). Safe mode skips main halves too: a privileged
 * half is exactly the kind of code most able to stop the app starting, so the
 * recovery flag has to cover it.
 */
export function bootMainPlugins() {
  if (safeMode()) {
    console.warn('[slick] safe mode: main-process plugin halves will not run');
    return;
  }
  for (const [id, entry] of registered) {
    try {
      entry.plugin.boot?.(entry.ctx);
    } catch (error) {
      console.error(`[slick] ${id} boot failed:`, error);
    }
  }
}

/** Called after app.whenReady(). */
export async function readyMainPlugins() {
  booted = true;
  if (safeMode()) return;
  for (const [id, entry] of registered) {
    try {
      await entry.plugin.ready?.(entry.ctx);
    } catch (error) {
      console.error(`[slick] ${id} ready failed:`, error);
    }
  }
}

export function windowCreated(window: Electron.BrowserWindow) {
  if (safeMode()) return;
  for (const [id, entry] of registered) {
    try {
      entry.plugin.window?.(entry.ctx, window);
    } catch (error) {
      console.error(`[slick] ${id} window hook failed:`, error);
    }
  }
}

/** Push resolved settings in from the settings file watcher. */
export function updateSettings(stored: Record<string, Record<string, unknown>> | undefined) {
  for (const entry of registered.values()) {
    entry.settings = resolveSettings(entry.schema, entry.defaultEnabled, stored?.[entry.plugin.id]);
    for (const listener of entry.settingsListeners) {
      try {
        listener(entry.settings);
      } catch (error) {
        console.error(`[slick] ${entry.plugin.id} settings listener threw:`, error);
      }
    }
  }
}

export function setupPluginRpc() {
  ipcMain.handle('slick:plugin-rpc', (event, id: string, method: string, args: unknown[]) => {
    if (!isSlackClient(event.senderFrame)) throw new Error('[slick] rejected sender');

    const entry = registered.get(id);
    if (!entry) throw new Error(`[slick] no main module for ${id}`);

    const rpc = entry.plugin.rpc ?? {};
    // Own properties only: a method name of "constructor" or "toString" must
    // not resolve through the prototype chain.
    if (!Object.hasOwn(rpc, method)) throw new Error(`[slick] unknown method: ${id}.${method}`);
    if (!Array.isArray(args)) throw new Error('[slick] bad args');

    return rpc[method](entry.ctx, args, event.sender);
  });
}

export function setupBlobRpc() {
  const methods: Record<string, (args: any[]) => unknown> = {
    blobList: ([namespace]) => blobStore.list(String(namespace)),
    blobRead: ([namespace, key]) => blobStore.read(String(namespace), String(key)),
    blobWrite: ([namespace, key, value]) => blobStore.write(String(namespace), String(key), String(value)),
    blobDelete: ([namespace, key]) => blobStore.remove(String(namespace), String(key)),
    blobClear: ([namespace]) => blobStore.clear(String(namespace)),
  };
  return methods;
}
