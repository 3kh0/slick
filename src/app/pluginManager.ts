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
import { onDocument, setStyle } from './api/css.ts';
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
import { messagesReady } from './slack/messages.ts';
import { reduxReady } from './slack/redux.ts';
import { rtmReady } from './slack/rtm.ts';
import { getByProps, getExport, getValueSource, waitForExport } from './slack/webpack.ts';

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
    // environment
    react: await reactReady,
    fetch: bridge.fetch.bind(bridge),
    onDocument,
  };
}

type BaseAPI = Awaited<ReturnType<typeof createBaseAPI>>;
export type SlickAPI = ReturnType<typeof createScopedAPI>;

function createScopedAPI(base: BaseAPI, id: string, scope: PluginScope, blob: BlobStore, channel: PluginChannel) {
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

    onDocument: tracked(base.onDocument),

    // Keys are namespaced so one plugin cannot replace another's stylesheet.
    setStyle: tracked((css: string | null, key = 'default') => setStyle(css, `plugin:${id}:${key}`)),

    storage,
    Cache: <T>(name: string, ttlMs?: number) => new Cache<T>(storage, name, ttlMs),

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
};

export class PluginManager {
  readonly plugins = new Map<string, Entry>();
  private baseAPI: Promise<BaseAPI>;
  private queues = new Map<string, Promise<unknown>>();

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
    });
    return id;
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

    if (!wanted) {
      if (entry.instance) await this.stop(id, entry);
      return;
    }
    if (!entry.instance) {
      await this.start(id, entry);
      return;
    }

    const changed = changedKeys(previous, next).filter((key) => key !== 'enabled');
    if (!changed.length) return;

    const live = new Set(entry.PluginClass.liveSettings ?? []);
    const allLive = changed.every((key) => live.has(key));

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
      await withTimeout(id, 'onSettingsChange', Promise.resolve(entry.instance.onSettingsChange(changed)));
      console.log(`[slick] ${id} applied live settings: ${changed.join(', ')}`);
    } catch (error) {
      console.error(`[slick] ${id} onSettingsChange failed:`, error);
    }
  }

  private async start(id: string, entry: Entry): Promise<void> {
    const base = await this.baseAPI;
    const scope = createScope();
    const api = createScopedAPI(base, id, scope, this.bridge.blobStore(`plugin:${id}`), this.bridge.plugin(id));

    let instance: SlickPlugin;
    try {
      instance = new entry.PluginClass(api, entry.settings);
    } catch (error) {
      console.error(`[slick] ${id} failed to construct:`, error);
      scope.dispose();
      return;
    }

    entry.instance = instance;
    entry.scope = scope;

    try {
      await withTimeout(id, 'start', Promise.resolve(instance.start()));
      console.log(`[slick] started ${id}`);
    } catch (error) {
      console.error(`[slick] ${id} failed to start:`, error);
      // A plugin that threw halfway through start has probably registered
      // some of its hooks; tear them down rather than leaving it half-applied.
      await this.stop(id, entry);
    }
  }

  private async stop(id: string, entry: Entry): Promise<void> {
    const { instance, scope } = entry;
    entry.instance = null;
    entry.scope = null;

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
    console.log(`[slick] stopped ${id}`);
  }

  info() {
    return [...this.plugins.entries()].map(([id, entry]) => ({
      id,
      name: entry.PluginClass.pluginName,
      description: entry.PluginClass.description,
      authors: entry.PluginClass.authors,
      settings: entry.PluginClass.settings,
      running: !!entry.instance,
      enabled: this.config.isActive(id),
    }));
  }
}
