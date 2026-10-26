// Every registration a plugin makes through its API is tracked and reversed on
// teardown, so `stop()` is only for things without a disposer. Plugins run
// before Slack, so a hang or throw could block boot: lifecycle calls are
// time-boxed and every failure is contained.

import { SlickPlugin, type SlickPluginConstructor, type PluginAPIName } from '../shared/Plugin.ts';
import { changedKeys, type PluginSettings } from '../shared/settings.ts';
import { type BlobStore, Cache, ScopedStorage } from './api/storage.ts';
import { readStoredFile } from './api/storedFiles.ts';
import { Store } from './store.ts';
import { onDocument, setStyle } from './api/css.ts';
import { deferResizeWork } from './api/resize.ts';
import type { PluginChannel, SlickBridge } from './bridge.ts';
import type { ConfigStore } from './configStore.ts';
import {
  getComponent,
  getComponentSource,
  getFiberFromNode,
  getRenderedComponent,
  patchComponent,
  patchingReady,
  reactReady,
  waitForComponent,
  waitForRenderedComponent,
} from './slack/react.tsx';
import { reduxReady } from './slack/redux.ts';
import { rtmReady } from './slack/rtm.ts';
import { findModuleId, getByProps, getExport, getValueSource, moduleSources, waitForExport } from './slack/webpack.ts';
import { userAPI } from './api/userAPI.ts';
import { addSettingsTab, type SettingsTab } from './api/settingsTabs.ts';

import { createAPILoader } from './apiLoader.ts';
import { createScope, type PluginScope } from './pluginScope.ts';
import { adoptPlugins, evaluatePlugin } from './userPlugins.ts';
import { appWideReason } from '../shared/pluginWorkspaces.ts';
import { currentWorkspaceId, watchWorkspace } from './workspaces.ts';

const loadAPIs = createAPILoader({
  redux: () => reduxReady,
  rtm: () => rtmReady,
  messages: (): Promise<import('./slack/messages.ts').MessagesAPI> =>
    import('./slack/messages.ts').then((m) => m.messagesReady),
  members: (): Promise<import('./slack/members.ts').MembersAPI> =>
    import('./slack/members.ts').then((m) => m.membersReady),
  channels: (): Promise<import('./slack/channels.ts').ChannelsAPI> =>
    import('./slack/channels.ts').then((m) => m.channelsReady),
  blocks: (): Promise<import('./slack/blocks.ts').BlocksAPI> => import('./slack/blocks.ts').then((m) => m.blocksReady),
  files: (): Promise<import('./slack/files.ts').FilesAPI> => import('./slack/files.ts').then((m) => m.filesReady),
  elements: (): Promise<import('./api/elements.ts').ElementsAPI> =>
    import('./api/elements.ts').then((m) => m.elementsReady),
  menu: (): Promise<import('./api/menu.tsx').MenuAPI> => import('./api/menu.tsx').then((m) => m.menuReady),
  modal: (): Promise<import('./api/modal.tsx').ModalAPI> => import('./api/modal.tsx').then((m) => m.modalReady),
  react: () => reactReady,
  onMessageSendDelta: (): Promise<ReturnType<typeof import('./api/messageSend.tsx').setupMessageSendDelta>> =>
    import('./api/messageSend.tsx').then((m) => m.setupMessageSendDelta(patchComponent)),
  onMessageSendBlocks: (): Promise<ReturnType<typeof import('./api/messageSendBlocks.ts').setupMessageSendBlocks>> =>
    Promise.all([import('./api/messageSendBlocks.ts'), reduxReady]).then(([m, redux]) =>
      m.setupMessageSendBlocks(redux),
    ),
  addSendCheck: (): Promise<ReturnType<typeof import('./api/sendChecks.tsx').setupSendChecks>> =>
    import('./api/sendChecks.tsx').then((m) => m.setupSendChecks(patchComponent)),
});

const PLUGIN_ID = /^[A-Za-z0-9_.-]{1,100}$/;
const LIFECYCLE_TIMEOUT_MS = 5_000;

function withTimeout<T>(id: string, phase: string, operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[slick] ${id} ${phase} timed out after ${LIFECYCLE_TIMEOUT_MS}ms`)),
      LIFECYCLE_TIMEOUT_MS,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function createBaseAPI(bridge: SlickBridge, required: readonly PluginAPIName[]) {
  await patchingReady;
  const integrations = await loadAPIs(required);
  return {
    getExport,
    getByProps,
    waitForExport,
    getComponent,
    waitForComponent,
    getRenderedComponent,
    waitForRenderedComponent,
    getComponentSource,
    getValueSource,
    findModuleId,
    moduleSources,
    getFiberFromNode,
    patchComponent,
    get redux() {
      return integrations.redux;
    },
    get rtm() {
      return integrations.rtm;
    },
    get messages() {
      return integrations.messages;
    },
    get members() {
      return integrations.members;
    },
    get channels() {
      return integrations.channels;
    },
    get blocks() {
      return integrations.blocks;
    },
    get files() {
      return integrations.files;
    },
    get elements() {
      return integrations.elements;
    },
    get menu() {
      return integrations.menu;
    },
    get modal() {
      return integrations.modal;
    },
    get onMessageSendDelta() {
      return integrations.onMessageSendDelta;
    },
    get onMessageSendBlocks() {
      return integrations.onMessageSendBlocks;
    },
    get addSendCheck() {
      return integrations.addSendCheck;
    },
    /** A reactive value a plugin's components can read with `.use()`. */
    Store,
    get react() {
      return integrations.react;
    },
    fetch: bridge.fetch.bind(bridge),
    loader: bridge.loader,
    userAPI,
    onDocument,
    deferResizeWork,
  };
}

type BaseAPI = Awaited<ReturnType<typeof createBaseAPI>>;
export type SlickAPI = ReturnType<typeof createScopedAPI>;

function createScopedAPI(
  base: BaseAPI,
  id: string,
  scope: PluginScope,
  blob: BlobStore,
  channel: PluginChannel,
  config: ConfigStore,
) {
  const tracked =
    <A extends unknown[]>(fn: (...args: A) => () => void) =>
    (...args: A) =>
      scope.track(fn(...args));

  const storage = new ScopedStorage(blob);
  const workspaceId = currentWorkspaceId();
  let redux: BaseAPI['redux'] | undefined;
  let rtm: BaseAPI['rtm'] | undefined;
  let messages: BaseAPI['messages'] | undefined;
  let onMessageSendDelta: BaseAPI['onMessageSendDelta'] | undefined;
  let onMessageSendBlocks: BaseAPI['onMessageSendBlocks'] | undefined;
  let addSendCheck: BaseAPI['addSendCheck'] | undefined;

  return {
    getExport: base.getExport,
    getByProps: base.getByProps,
    waitForExport: base.waitForExport,
    getComponent: base.getComponent,
    waitForComponent: base.waitForComponent,
    getRenderedComponent: base.getRenderedComponent,
    waitForRenderedComponent: base.waitForRenderedComponent,
    getComponentSource: base.getComponentSource,
    getValueSource: base.getValueSource,
    findModuleId: base.findModuleId,
    moduleSources: base.moduleSources,
    getFiberFromNode: base.getFiberFromNode,
    Store: base.Store,
    fetch: base.fetch,
    loader: base.loader,
    userAPI: base.userAPI,
    get members() {
      return base.members;
    },
    get channels() {
      return base.channels;
    },
    get blocks() {
      return base.blocks;
    },
    get files() {
      return base.files;
    },
    get elements() {
      return base.elements;
    },
    get menu() {
      return base.menu;
    },
    get modal() {
      return base.modal;
    },
    get react() {
      return base.react;
    },
    id,
    signal: scope.signal,
    isActive: () =>
      !scope.signal.aborted && config.isActive(id) && (!!appWideReason(id) || currentWorkspaceId() === workspaceId),

    patchComponent: tracked(base.patchComponent) as typeof base.patchComponent,

    get redux() {
      return (redux ??= {
        ...base.redux,
        patchState: tracked(base.redux.patchState),
        patchSlice: tracked(base.redux.patchSlice) as typeof base.redux.patchSlice,
        patchThunk: tracked(base.redux.patchThunk) as typeof base.redux.patchThunk,
      });
    },

    get rtm() {
      return (rtm ??= { ...base.rtm, on: tracked(base.rtm.on) });
    },
    get messages() {
      return (messages ??= {
        ...base.messages,
        injectMessages: tracked(base.messages.injectMessages),
      });
    },

    get onMessageSendDelta() {
      return (onMessageSendDelta ??= tracked(base.onMessageSendDelta));
    },

    get onMessageSendBlocks() {
      return (onMessageSendBlocks ??= tracked(base.onMessageSendBlocks));
    },

    get addSendCheck() {
      return (addSendCheck ??= tracked(base.addSendCheck));
    },

    /** Notified for each of Slack's pop-out documents (slack/childWindows.ts). */
    onDocument: tracked(base.onDocument),

    deferResizeWork: tracked(base.deferResizeWork),

    // Keys are namespaced so one plugin cannot replace another's stylesheet.
    setStyle: tracked((css: string | null, key = 'default') => setStyle(css, `plugin:${id}:${key}`)),

    storage,
    storedFileUrl: async (setting: string) => {
      const file = await readStoredFile(blob, setting).catch(() => null);
      if (!file || scope.signal.aborted) return null;
      const url = URL.createObjectURL(file);
      scope.track(() => URL.revokeObjectURL(url));
      return url;
    },
    Cache: <T>(name: string, ttlMs?: number | ((value: T) => number), maxEntries?: number) =>
      new Cache<T>(storage, name, ttlMs, maxEntries),

    /**
     * Persist one of this plugin's settings. The key must be in the schema and
     * `liveSettings`, or writing it restarts the plugin.
     */
    settings: {
      set: (key: string, value: unknown) => config.setPluginSetting(id, key, value),
      addTab: tracked((tab: Omit<SettingsTab, 'id'>) => addSettingsTab({ ...tab, id: `slick-plugin-${id}` })),
    },

    /** This plugin's main-process half. The id is bound; it cannot be spoofed. */
    main: {
      call: channel.call,
      on: tracked(channel.on),
    },
  };
}

type Entry = {
  PluginClass: SlickPluginConstructor;
  instance: SlickPlugin | null;
  scope: PluginScope | null;
  settings: PluginSettings;
  running: boolean;
  startError: string | null;
  workspaceId: string | null;
  user: boolean;
};

export type UpdateResult = { updated: string[]; failed: number };

const UPDATE_DELAY_MS = 15_000;
const UPDATE_INTERVAL_MS = 3 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 20_000;

/** Accepts https (or http on localhost) and turns GitHub file pages into their raw files. */
export function pluginUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('That is not a valid URL.');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Plugin URLs must use https.');
  const blob = url.hostname === 'github.com' && /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.pathname);
  if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}${url.search}`;
  return url.href;
}

export class PluginManager {
  readonly plugins = new Map<string, Entry>();
  private queues = new Map<string, Promise<unknown>>();
  private statusListeners = new Set<() => void>();
  private sources = new Map<string, string>();
  private autoUpdate = true;
  private updating: Promise<UpdateResult> | null = null;

  constructor(
    private bridge: SlickBridge,
    private config: ConfigStore,
  ) {
    this.config.onConfigChange(() => void this.reconcile());
    watchWorkspace(() => {
      void this.reconcile();
      this.notifyStatus();
    });
  }

  /** Serialize lifecycle work per plugin, so enable/disable cannot interleave. */
  private exclusive<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = (this.queues.get(id) ?? Promise.resolve()).catch(() => {});
    const result = previous.then(task);
    this.queues.set(
      id,
      result.then(
        () => {},
        () => {},
      ),
    );
    return result;
  }

  private validId(PluginClass: SlickPluginConstructor): string | null {
    if (typeof PluginClass !== 'function' || !(PluginClass.prototype instanceof SlickPlugin)) {
      console.error('[slick] plugin does not extend SlickPlugin');
      return null;
    }

    const id = PluginClass.id;
    if (typeof id !== 'string' || !PLUGIN_ID.test(id)) {
      console.error(`[slick] plugin has an invalid id: ${String(id)}`);
      return null;
    }
    return id;
  }

  register(PluginClass: SlickPluginConstructor, user = false): string | null {
    const id = this.validId(PluginClass);
    if (!id) return null;
    if (this.plugins.has(id)) {
      console.error(`[slick] duplicate plugin id: ${id}`);
      return null;
    }

    this.config.registerSchema(id, PluginClass.settings ?? {}, PluginClass.defaultEnabled === true);
    this.plugins.set(id, {
      PluginClass,
      instance: null,
      scope: null,
      settings: this.config.settingsFor(id),
      running: false,
      startError: null,
      workspaceId: null,
      user,
    });
    return id;
  }

  async replace(PluginClass: SlickPluginConstructor): Promise<void> {
    const id = this.validId(PluginClass);
    const entry = id ? this.plugins.get(id) : undefined;
    if (!id || !entry) return;
    await this.exclusive(id, async () => {
      if (entry.instance) await this.stop(id, entry);
      entry.PluginClass = PluginClass;
      this.config.registerSchema(id, PluginClass.settings ?? {}, PluginClass.defaultEnabled === true);
      entry.settings = this.config.settingsFor(id);
      if (this.config.isActive(id)) await this.start(id, entry);
      else this.notifyStatus();
    });
    console.log(`[slick] reloaded ${id}`);
  }

  get supportsUserPlugins(): boolean {
    return __SLICK_LOADER__ === 'electron' && this.bridge.loader === 'electron';
  }

  private get userPlugins() {
    return this.bridge.blobStore('user-plugins');
  }

  private get userPluginPrefs() {
    return this.bridge.blobStore('user-plugin-prefs');
  }

  private get userPluginSources() {
    return this.bridge.blobStore('user-plugin-sources');
  }

  async loadUserPlugins(): Promise<void> {
    if (!this.supportsUserPlugins) return;
    const [sources, autoUpdate, stored] = await Promise.all([
      this.userPluginSources.readAll(),
      this.userPluginPrefs.read('autoUpdate'),
      this.userPlugins.readAll(),
    ]);
    this.sources = new Map(Object.entries(sources));
    this.autoUpdate = autoUpdate !== 'off';
    for (const [key, code] of Object.entries(stored)) {
      try {
        const PluginClass = evaluatePlugin(code);
        if (PluginClass.id !== key) throw new Error(`stored as ${key} but declares ${String(PluginClass.id)}`);
        this.register(PluginClass, true);
      } catch (error) {
        console.error(`[slick] could not load user plugin ${key}:`, error);
      }
    }
  }

  /** Registers plugins that web user scripts hand to the page. */
  adoptUserPlugins(): void {
    let booted = false;
    adoptPlugins((PluginClass) => {
      if (this.register(PluginClass, true) && booted) void this.reconcile();
    });
    booted = true;
  }

  /** Installs or updates a user plugin and returns its name. */
  async installUserPlugin(code: string, source?: string, expectedId?: string): Promise<string> {
    const PluginClass = evaluatePlugin(code);
    const id = this.validId(PluginClass);
    if (!id) throw new Error('That file is not a Slick plugin.');
    if (expectedId && id !== expectedId) throw new Error(`the file now declares ${id}, not ${expectedId}`);
    const existing = this.plugins.get(id);
    if (existing && !existing.user) throw new Error(`${id} is built into Slick.`);
    if (!(await this.userPlugins.write(id, code))) throw new Error('Could not save the plugin.');
    if (source) {
      if (this.sources.get(id) !== source && (await this.userPluginSources.write(id, source))) {
        this.sources.set(id, source);
      }
    } else if (this.sources.delete(id)) {
      await this.userPluginSources.delete(id);
    }
    if (existing) await this.replace(PluginClass);
    else if (this.register(PluginClass, true)) await this.reconcile();
    this.notifyStatus();
    return PluginClass.pluginName || id;
  }

  async removeUserPlugin(id: string): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry?.user) return;
    await this.exclusive(id, async () => {
      if (entry.instance) await this.stop(id, entry);
      this.plugins.delete(id);
    });
    this.sources.delete(id);
    await Promise.all([
      this.userPlugins.delete(id),
      this.userPluginSources.delete(id),
      this.bridge.blobStore(`plugin:${id}`).clear(),
    ]);
    this.notifyStatus();
  }

  private async fetchPluginCode(url: string): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        this.bridge.fetch(url),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('the request timed out')), FETCH_TIMEOUT_MS);
        }),
      ]);
      if (response.status !== 200) throw new Error(`the server answered ${response.status}`);
      return response.body;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Installs a plugin from a URL and remembers it so it keeps updating. */
  async installUserPluginFromUrl(input: string): Promise<string> {
    const url = pluginUrl(input);
    let code: string;
    try {
      code = await this.fetchPluginCode(url);
    } catch (error) {
      throw new Error(`Could not download the plugin: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
    return this.installUserPlugin(code, url);
  }

  /** Re-downloads every URL-installed plugin and installs the ones that changed. */
  updateUserPlugins(): Promise<UpdateResult> {
    return (this.updating ??= this.runUpdates().finally(() => (this.updating = null)));
  }

  private async runUpdates(): Promise<UpdateResult> {
    const result: UpdateResult = { updated: [], failed: 0 };
    if (!this.supportsUserPlugins) return result;
    await Promise.all(
      [...this.sources].map(async ([id, url]) => {
        try {
          const code = await this.fetchPluginCode(url);
          // Removed or reinstalled from elsewhere while the download ran.
          if (this.sources.get(id) !== url || code === (await this.userPlugins.read(id))) return;
          result.updated.push(await this.installUserPlugin(code, url, id));
          console.log(`[slick] updated ${id} from ${url}`);
        } catch (error) {
          result.failed++;
          console.warn(`[slick] could not update ${id}:`, error);
        }
      }),
    );
    return result;
  }

  get autoUpdatesEnabled(): boolean {
    return this.autoUpdate;
  }

  async setAutoUpdate(enabled: boolean): Promise<void> {
    const saved = enabled
      ? await this.userPluginPrefs.delete('autoUpdate')
      : await this.userPluginPrefs.write('autoUpdate', 'off');
    if (!saved) throw new Error('Could not save the setting.');
    this.autoUpdate = enabled;
    this.notifyStatus();
  }

  /** Checks for plugin updates shortly after boot, then every few hours. */
  startAutoUpdate(): void {
    if (!this.supportsUserPlugins) return;
    const check = () => {
      if (this.autoUpdate) void this.updateUserPlugins();
    };
    setTimeout(check, UPDATE_DELAY_MS);
    setInterval(check, UPDATE_INTERVAL_MS);
  }

  onStatusChange(cb: () => void): () => void {
    this.statusListeners.add(cb);
    return () => void this.statusListeners.delete(cb);
  }

  private notifyStatus(): void {
    for (const notify of this.statusListeners) {
      try {
        notify();
      } catch (error) {
        console.error('[slick] plugin status listener threw:', error);
      }
    }
  }

  async reconcile(): Promise<void> {
    // Cancel resources immediately, even if an async lifecycle call is queued.
    for (const [id, entry] of this.plugins) {
      if (!this.config.isActive(id) || (!appWideReason(id) && entry.workspaceId !== currentWorkspaceId())) {
        entry.scope?.dispose();
      }
    }
    await Promise.all(
      [...this.plugins.keys()].map((id) =>
        this.exclusive(id, () => this.reconcileOne(id)).catch((error) =>
          console.error(`[slick] ${id} failed to reconcile:`, error),
        ),
      ),
    );
  }

  private async reconcileOne(id: string): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry) return;

    const wanted = this.config.isActive(id);
    const next = this.config.settingsFor(id);
    const previous = entry.settings;
    entry.settings = next;
    const changed = changedKeys(previous, next);

    if (entry.workspaceId !== currentWorkspaceId()) entry.startError = null;
    if (entry.scope?.signal.aborted) await this.stop(id, entry);

    if (!wanted) {
      if (entry.instance) await this.stop(id, entry);
      if (entry.startError) {
        entry.startError = null;
        this.notifyStatus();
      }
      return;
    }
    if (!entry.instance) {
      // Stays failed until its own config changes, so unrelated broadcasts don't retry-loop.
      if (entry.startError && !changed.length) return;
      await this.start(id, entry);
      return;
    }

    const settingChanges = changed.filter((key) => key !== 'enabled');
    if (!settingChanges.length) return;

    const live = new Set(entry.PluginClass.liveSettings ?? []);
    const allLive = settingChanges.every((key) => live.has(key));

    if (!allLive) {
      await this.stop(id, entry);
      await this.start(id, entry);
      return;
    }

    // Mutated in place: the plugin's closures already captured this object.
    Object.assign(entry.instance['config' as keyof SlickPlugin] as object, next);
    try {
      await withTimeout(id, 'onSettingsChange', Promise.resolve(entry.instance.onSettingsChange(settingChanges)));
      console.log(`[slick] ${id} applied live settings: ${settingChanges.join(', ')}`);
    } catch (error) {
      console.error(`[slick] ${id} onSettingsChange failed:`, error);
    }
  }

  private async start(id: string, entry: Entry): Promise<void> {
    const workspaceId = currentWorkspaceId();
    entry.workspaceId = workspaceId;
    entry.startError = null;
    entry.running = false;
    this.notifyStatus();

    let base: BaseAPI;
    try {
      base = await withTimeout(id, 'API discovery', createBaseAPI(this.bridge, entry.PluginClass.requiredAPIs));
    } catch (error) {
      entry.startError = error instanceof Error ? error.message : String(error);
      this.notifyStatus();
      return;
    }
    if (!this.config.isActive(id) || workspaceId !== currentWorkspaceId()) return;
    const scope = createScope();
    const api = createScopedAPI(
      base,
      id,
      scope,
      this.bridge.blobStore(`plugin:${id}`),
      this.bridge.plugin(id),
      this.config,
    );

    let instance: SlickPlugin;
    try {
      instance = new entry.PluginClass(api, entry.settings);
    } catch (error) {
      console.error(`[slick] ${id} failed to construct:`, error);
      scope.dispose();
      entry.startError = error instanceof Error ? error.message : String(error);
      this.notifyStatus();
      return;
    }

    entry.instance = instance;
    entry.scope = scope;
    entry.workspaceId = workspaceId;

    try {
      await withTimeout(id, 'start', Promise.resolve(instance.start()));
      if (scope.signal.aborted || !this.config.isActive(id) || workspaceId !== currentWorkspaceId()) {
        await this.stop(id, entry);
        return;
      }
      entry.running = true;
      this.notifyStatus();
      console.log(`[slick] started ${id}`);
    } catch (error) {
      console.error(`[slick] ${id} failed to start:`, error);
      // Tear down whatever it registered before throwing.
      await this.stop(id, entry);
      entry.startError = error instanceof Error ? error.message : String(error);
      this.notifyStatus();
    }
  }

  private async stop(id: string, entry: Entry): Promise<void> {
    const { instance, scope } = entry;
    entry.instance = null;
    entry.scope = null;
    entry.running = false;
    scope?.dispose();

    if (instance) {
      try {
        await withTimeout(id, 'stop', Promise.resolve(instance.stop()));
      } catch (error) {
        console.error(`[slick] ${id} failed to stop cleanly:`, error);
      }
    }
    this.notifyStatus();
    console.log(`[slick] stopped ${id}`);
  }

  info() {
    return [...this.plugins.entries()].map(([id, entry]) => ({
      id,
      name: entry.PluginClass.pluginName,
      description: entry.PluginClass.description,
      authors: entry.PluginClass.authors,
      settings: entry.PluginClass.settings,
      relaunchSettings: entry.PluginClass.relaunchSettings,
      running: entry.running,
      enabled: this.config.settingsFor(id).enabled === true,
      active: this.config.isActive(id),
      workspaceAllowed: this.config.isAllowedInWorkspace(id),
      appWideReason: appWideReason(id),
      startError: entry.startError,
      user: entry.user,
      source: this.sources.get(id) ?? null,
    }));
  }
}
