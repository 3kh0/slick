// Runs plugins' main-process halves and exposes their RPC to the renderer. The
// plugin id comes from the page and is not an identity boundary, so dispatch
// also checks activation.

import { app, dialog, ipcMain, Notification, protocol, session, shell, webContents } from 'electron';
import type { Capability, MainCtx, ProtocolPrivileges, SlickMainPlugin } from '../shared/main.ts';
import { type PluginSettings, resolveSettings, type SettingsSchema } from '../shared/settings.ts';
import * as blobStore from './blobStore.js';
import { isSlackClient, safeMode } from './bridge.js';
import * as secretStore from './secretStore.js';

type Registered = {
  plugin: SlickMainPlugin;
  ctx: MainCtx;
  schema: SettingsSchema;
  defaultEnabled: boolean;
  settings: PluginSettings;
  settingsListeners: Set<(settings: PluginSettings) => void>;
  protocols: Array<{
    scheme: string;
    privileges: ProtocolPrivileges;
    handler: (request: Request) => Response | Promise<Response>;
  }>;
  running: boolean;
  dispose: (() => void | Promise<void>) | null;
  queue: Promise<void>;
};

const registered = new Map<string, Registered>();
let booted = false;
let globallyEnabled = true;

// Shared hooks: one patch with a list of participants, so plugins patching the
// same thing don't silently override each other.

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

type RequestHandler = (details: Electron.OnBeforeRequestListenerDetails) => Electron.CallbackResponse | void;
const requestHandlers = new Set<{ patterns: string[]; handler: RequestHandler }>();

function requestMatches(url: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern === '<all_urls>') return true;
    const expression = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
    return new RegExp(`^${expression}$`).test(url);
  });
}

function installRequestDispatcher() {
  const webRequest = session.defaultSession.webRequest;
  if (!requestHandlers.size) {
    webRequest.onBeforeRequest(null);
    return;
  }

  const urls = [...new Set([...requestHandlers].flatMap((registration) => registration.patterns))];
  webRequest.onBeforeRequest({ urls }, (details, callback) => {
    let response: Electron.CallbackResponse = {};
    for (const registration of requestHandlers) {
      if (!requestMatches(details.url, registration.patterns)) continue;
      let next: Electron.CallbackResponse | void;
      try {
        next = registration.handler(details);
      } catch (error) {
        console.error('[slick] request handler threw:', error);
        continue;
      }
      if (!next) continue;
      if (next.cancel) {
        response = { cancel: true };
        break;
      }
      if (next.redirectURL) response = next;
    }
    callback(response);
  });
}

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
      readAll: (prefix) => blobStore.readAll(namespace, prefix),
      write: (key, value) => blobStore.write(namespace, key, value),
      delete: (key) => blobStore.remove(namespace, key),
      clear: () => blobStore.clear(namespace),
    },

    protocol: {
      register(scheme: string, privileges: ProtocolPrivileges, handler) {
        need('protocol');
        if (booted) throw new Error(`[slick] ${id}: protocols must be declared during boot`);
        protocol.registerSchemesAsPrivileged([{ scheme, privileges }]);
        entry().protocols.push({ scheme, privileges, handler });
      },
    },

    net: {
      block(patterns) {
        need('requests');
        const registration = { patterns, handler: () => ({ cancel: true }) };
        requestHandlers.add(registration);
        installRequestDispatcher();
        return () => {
          requestHandlers.delete(registration);
          installRequestDispatcher();
        };
      },
      intercept(patterns, handler) {
        need('requests');
        const registration = { patterns, handler };
        requestHandlers.add(registration);
        installRequestDispatcher();
        return () => {
          requestHandlers.delete(registration);
          installRequestDispatcher();
        };
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
        // file:// and custom schemes turn openExternal into local execution.
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

    cookies: {
      async get(details) {
        need('cookies');
        return (await session.defaultSession.cookies.get(details))[0] ?? null;
      },
      set(details) {
        need('cookies');
        return session.defaultSession.cookies.set(details);
      },
      remove(url, name) {
        need('cookies');
        return session.defaultSession.cookies.remove(url, name);
      },
    },

    secrets: {
      read(key) {
        need('secrets');
        return secretStore.read(id, key);
      },
      write(key, value) {
        need('secrets');
        return secretStore.write(id, key, value);
      },
      delete(key) {
        need('secrets');
        return secretStore.remove(id, key);
      },
    },
  } as MainCtx;
}

export type PluginMeta = Record<string, { schema: SettingsSchema; defaultEnabled: boolean }>;

export function registerMainPlugins(plugins: SlickMainPlugin[], meta: PluginMeta) {
  for (const plugin of plugins) {
    if (!plugin?.id || registered.has(plugin.id)) continue;

    const schema = (meta[plugin.id]?.schema ?? {}) as SettingsSchema;
    const defaultEnabled = meta[plugin.id]?.defaultEnabled === true;
    const entry: Registered = {
      plugin,
      schema,
      defaultEnabled,
      settingsListeners: new Set<(settings: PluginSettings) => void>(),
      settings: resolveSettings(schema, defaultEnabled, undefined),
      protocols: [],
      running: false,
      dispose: null,
      queue: Promise.resolve(),
      // Filled in below; createCtx needs the entry.
      ctx: null as unknown as MainCtx,
    };

    entry.ctx = createCtx(plugin, () => entry);
    registered.set(plugin.id, entry);
  }
}

/** Before app.whenReady(). Safe mode skips main halves: they can stop the app starting. */
export function bootMainPlugins() {
  if (safeMode()) {
    console.warn('[slick] safe mode: main-process plugin halves will not run');
    return;
  }
  for (const [id, entry] of registered) {
    // Schemes must be declared before ready even if the plugin is off, so a
    // later enable can install the handler.
    if (!isActive(entry) && !entry.plugin.capabilities.includes('protocol')) continue;
    try {
      entry.plugin.boot?.(entry.ctx);
    } catch (error) {
      console.error(`[slick] ${id} boot failed:`, error);
    }
  }
}

export async function readyMainPlugins() {
  booted = true;
  if (safeMode()) return;
  await Promise.all([...registered.values()].map((entry) => reconcile(entry)));
}

export function windowCreated(window: Electron.BrowserWindow) {
  if (safeMode()) return;
  for (const [id, entry] of registered) {
    if (!isActive(entry) || !entry.running) continue;
    try {
      entry.plugin.window?.(entry.ctx, window);
    } catch (error) {
      console.error(`[slick] ${id} window hook failed:`, error);
    }
  }
}

function isActive(entry: Registered): boolean {
  return globallyEnabled && entry.settings.enabled === true;
}

async function start(entry: Registered) {
  if (entry.running || !isActive(entry)) return;

  const installedSchemes: string[] = [];
  try {
    for (const registration of entry.protocols) {
      session.defaultSession.protocol.handle(registration.scheme, registration.handler);
      installedSchemes.push(registration.scheme);
    }
    const dispose = await entry.plugin.ready?.(entry.ctx);
    entry.dispose = typeof dispose === 'function' ? dispose : null;
    entry.running = true;
  } catch (error) {
    for (const scheme of installedSchemes) session.defaultSession.protocol.unhandle(scheme);
    console.error(`[slick] ${entry.plugin.id} ready failed:`, error);
  }
}

async function stop(entry: Registered) {
  if (!entry.running) return;
  entry.running = false;
  try {
    await entry.dispose?.();
  } catch (error) {
    console.error(`[slick] ${entry.plugin.id} dispose failed:`, error);
  }
  entry.dispose = null;
  entry.settingsListeners.clear();
  for (const registration of entry.protocols) session.defaultSession.protocol.unhandle(registration.scheme);
}

function reconcile(entry: Registered): Promise<void> {
  entry.queue = entry.queue.then(() => (isActive(entry) ? start(entry) : stop(entry)));
  return entry.queue;
}

export function updateSettings(stored: { enabled?: boolean; plugins?: Record<string, Record<string, unknown>> }) {
  const previousGlobal = globallyEnabled;
  globallyEnabled = stored.enabled !== false;
  for (const entry of registered.values()) {
    const wasActive = previousGlobal && entry.settings.enabled === true;
    entry.settings = resolveSettings(entry.schema, entry.defaultEnabled, stored.plugins?.[entry.plugin.id]);
    const active = isActive(entry);
    if (booted && wasActive !== active) {
      void reconcile(entry);
    } else if (active) {
      for (const listener of entry.settingsListeners) {
        try {
          listener(entry.settings);
        } catch (error) {
          console.error(`[slick] ${entry.plugin.id} settings listener threw:`, error);
        }
      }
    }
  }
}

export function setupPluginRpc() {
  ipcMain.handle('slick:plugin-rpc', async (event, id: string, method: string, args: unknown[]) => {
    if (!isSlackClient(event.senderFrame)) throw new Error('[slick] rejected sender');

    const entry = registered.get(id);
    if (!entry) throw new Error(`[slick] no main module for ${id}`);
    await entry.queue;
    if (!isActive(entry) || !entry.running) throw new Error(`[slick] ${id} is disabled`);

    const rpc = entry.plugin.rpc ?? {};
    // Own properties only, so "constructor"/"toString" don't resolve via the prototype.
    if (!Object.hasOwn(rpc, method)) throw new Error(`[slick] unknown method: ${id}.${method}`);
    if (!Array.isArray(args)) throw new Error('[slick] bad args');

    return rpc[method](entry.ctx, args, event.sender);
  });
}

export function setupBlobRpc() {
  const methods: Record<string, (args: any[]) => unknown> = {
    blobList: ([namespace]) => blobStore.list(String(namespace)),
    blobRead: ([namespace, key]) => blobStore.read(String(namespace), String(key)),
    blobReadAll: ([namespace, prefix]) => blobStore.readAll(String(namespace), prefix ? String(prefix) : ''),
    blobWrite: ([namespace, key, value]) => blobStore.write(String(namespace), String(key), String(value)),
    blobDelete: ([namespace, key]) => blobStore.remove(String(namespace), String(key)),
    blobClear: ([namespace]) => blobStore.clear(String(namespace)),
  };
  return methods;
}
