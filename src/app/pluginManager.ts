// Slick Plugin Manager
//
// Builds each plugin's API, runs its lifecycle, and guarantees that disabling
// a plugin actually undoes it. Every registration a plugin makes through its
// API is tracked and reversed on teardown, so `stop()` is for things the API
// did not hand back a disposer for -- which should be almost nothing.
//
// Running before Slack means a plugin that hangs or throws can stop Slack
// booting, so lifecycle calls are time-boxed and every failure is contained.

import { SlickPlugin, type SlickPluginConstructor } from '../shared/Plugin.ts';
import { changedKeys, type PluginSettings } from '../shared/settings.ts';
import { type BlobStore, Cache, ScopedStorage } from './api/storage.ts';
import { Store } from './store.ts';
import { setStyle } from './api/css.ts';
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
import { blocksReady } from './slack/blocks.ts';
import { channelsReady } from './slack/channels.ts';
import { filesReady } from './slack/files.ts';
import { membersReady } from './slack/members.ts';
import { messagesReady } from './slack/messages.ts';
import { reduxReady } from './slack/redux.ts';
import { rtmReady } from './slack/rtm.ts';
import { getByProps, getExport, getValueSource, waitForExport } from './slack/webpack.ts';
import { elementsReady } from './api/elements.ts';
import { menuReady } from './api/menu.tsx';
import { modalReady } from './api/modal.tsx';
import { setupMessageSendDelta } from './api/messageSend.tsx';
import { userAPI } from './api/userAPI.ts';

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

// Scope

type PluginScope = {
  signal: AbortSignal;
  track(cleanup: () => void): () => void;
  dispose(): void;
};

function createScope(): PluginScope {
  let active = true;
  const controller = new AbortController();
  const cleanups: (() => void)[] = [];

  return {
    signal: controller.signal,
    track(cleanup) {
      let done = false;
      const once = () => {
        if (done) return;
        done = true;
        cleanup();
      };
      // A disposer handed back after teardown runs immediately, so a slow
      // async registration cannot outlive the plugin that asked for it.
      if (active) cleanups.push(once);
      else once();
      return once;
    },
    dispose() {
      if (!active) return;
      active = false;
      controller.abort();
      for (let i = cleanups.length - 1; i >= 0; i--) {
        try {
          cleanups[i]();
        } catch (error) {
          console.error('[slick] error disposing plugin resource:', error);
        }
      }
    },
  };
}

// API

async function createBaseAPI(bridge: SlickBridge) {
  await patchingReady;
  return {
    // discovery
    getExport,
    getByProps,
    waitForExport,
    getComponent,
    waitForComponent,
    getRenderedComponent,
    waitForRenderedComponent,
    getComponentSource,
    getValueSource,
    getFiberFromNode,
    // patching
    patchComponent,
    redux: await reduxReady,
    rtm: await rtmReady,
    messages: await messagesReady,
    members: await membersReady,
    channels: await channelsReady,
    blocks: await blocksReady,
    files: await filesReady,
    // Slack's three composer components are patched once here, so plugin
    // transforms compose instead of each wrapping the others' props.
    onMessageSendDelta: setupMessageSendDelta(patchComponent),
    // UI
    elements: await elementsReady,
    menu: await menuReady,
    modal: await modalReady,
    // environment
    /** A reactive value a plugin's components can read with `.use()`. */
    Store,
    react: await reactReady,
    fetch: bridge.fetch.bind(bridge),
    userAPI,
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
  // Wrap a registration so its disposer is run automatically on teardown.
  const tracked =
    <A extends unknown[]>(fn: (...args: A) => () => void) =>
    (...args: A) =>
      scope.track(fn(...args));

  const storage = new ScopedStorage(blob);

  return {
    ...base,
    id,
    signal: scope.signal,

    patchComponent: tracked(base.patchComponent) as typeof base.patchComponent,

    redux: {
      ...base.redux,
      patchState: tracked(base.redux.patchState),
      patchSlice: tracked(base.redux.patchSlice) as typeof base.redux.patchSlice,
      patchThunk: tracked(base.redux.patchThunk) as typeof base.redux.patchThunk,
    },

    rtm: { ...base.rtm, on: tracked(base.rtm.on) },
    messages: {
      ...base.messages,
      injectMessages: tracked(base.messages.injectMessages),
    },

    onMessageSendDelta: tracked(base.onMessageSendDelta),

    /** Hold Slack's resize handlers until the window stops moving. */
    deferResizeWork: tracked(base.deferResizeWork),

    // Keys are namespaced so one plugin cannot replace another's stylesheet.
    setStyle: tracked((css: string | null, key = 'default') => setStyle(css, `plugin:${id}:${key}`)),

    storage,
    Cache: <T>(name: string, ttlMs?: number) => new Cache<T>(storage, name, ttlMs),

    /**
     * This plugin's own settings, written back to the settings file so
     * Preferences shows them. The key must be declared in the schema and in
     * `liveSettings`, or writing it restarts the plugin that just wrote it.
     */
    settings: {
      set: (key: string, value: unknown) => config.setPluginSetting(id, key, value),
    },

    /** This plugin's main-process half. The id is bound; it cannot be spoofed. */
    main: {
      call: channel.call,
      on: tracked(channel.on),
    },
  };
}

// Manager

type Entry = {
  PluginClass: SlickPluginConstructor;
  instance: SlickPlugin | null;
  scope: PluginScope | null;
  settings: PluginSettings;
  running: boolean;
  startError: string | null;
};

export class PluginManager {
  readonly plugins = new Map<string, Entry>();
  private baseAPI: Promise<BaseAPI>;
  private queues = new Map<string, Promise<unknown>>();
  private statusListeners = new Set<() => void>();

  constructor(
    private bridge: SlickBridge,
    private config: ConfigStore,
  ) {
    this.baseAPI = createBaseAPI(bridge);
    this.config.onConfigChange(() => void this.reconcile());
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

  /** Evaluate a bundled plugin IIFE and validate what it produced. */
  register(code: string): string | null {
    let PluginClass: SlickPluginConstructor;
    try {
      const result = new Function(`return ${code}`)();
      PluginClass = (result?.prototype instanceof SlickPlugin ? result : result?.default) as SlickPluginConstructor;
    } catch (error) {
      console.error('[slick] plugin failed to evaluate:', error);
      return null;
    }

    if (typeof PluginClass !== 'function' || !(PluginClass.prototype instanceof SlickPlugin)) {
      console.error('[slick] plugin does not extend SlickPlugin');
      return null;
    }

    const id = PluginClass.id;
    if (typeof id !== 'string' || !PLUGIN_ID.test(id)) {
      console.error(`[slick] plugin has an invalid id: ${String(id)}`);
      return null;
    }
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
    });
    return id;
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

  /** Bring every plugin's running state in line with its configuration. */
  async reconcile(): Promise<void> {
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

    if (!wanted) {
      if (entry.instance) await this.stop(id, entry);
      if (entry.startError) {
        entry.startError = null;
        this.notifyStatus();
      }
      return;
    }
    if (!entry.instance) {
      // A failed start stays failed until this plugin's own configuration
      // changes. Unrelated settings broadcasts must not create a retry loop.
      if (entry.startError && !changed.length) return;
      await this.start(id, entry);
      return;
    }

    const settingChanges = changed.filter((key) => key !== 'enabled');
    if (!settingChanges.length) return;

    const live = new Set(entry.PluginClass.liveSettings ?? []);
    const allLive = settingChanges.every((key) => live.has(key));

    if (!allLive) {
      // Anything not declared live restarts the plugin: simpler than asking
      // every plugin to reconfigure itself correctly, at the cost of losing
      // in-memory state.
      await this.stop(id, entry);
      await this.start(id, entry);
      return;
    }

    // Live path. The plugin's own config object is mutated in place, because
    // its closures already captured it.
    Object.assign(entry.instance['config' as keyof SlickPlugin] as object, next);
    try {
      await withTimeout(id, 'onSettingsChange', Promise.resolve(entry.instance.onSettingsChange(settingChanges)));
      console.log(`[slick] ${id} applied live settings: ${settingChanges.join(', ')}`);
    } catch (error) {
      console.error(`[slick] ${id} onSettingsChange failed:`, error);
    }
  }

  private async start(id: string, entry: Entry): Promise<void> {
    entry.startError = null;
    entry.running = false;
    this.notifyStatus();

    const base = await this.baseAPI;
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

    try {
      await withTimeout(id, 'start', Promise.resolve(instance.start()));
      entry.running = true;
      this.notifyStatus();
      console.log(`[slick] started ${id}`);
    } catch (error) {
      console.error(`[slick] ${id} failed to start:`, error);
      // A plugin that threw halfway through start has probably registered
      // some of its hooks; tear them down rather than leaving it half-applied.
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

    if (instance) {
      try {
        await withTimeout(id, 'stop', Promise.resolve(instance.stop()));
      } catch (error) {
        console.error(`[slick] ${id} failed to stop cleanly:`, error);
      }
    }
    // Always dispose, even if stop() threw: the tracked registrations are the
    // ones that actually change Slack, and they have to come off.
    scope?.dispose();
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
      enabled: this.config.isActive(id),
      startError: entry.startError,
    }));
  }
}
