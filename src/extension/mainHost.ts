// Background host for plugins' privileged halves: the Firefox counterpart of
// desktop/pluginHost.ts, offering the parts of MainCtx a browser can.
//
// Requests are blocked with declarativeNetRequest session rules scoped to
// requests Slack makes, so nothing else in the browser is touched, no host
// permissions are needed, and rules outlive the event page being suspended.

import type { Capability, MainCtx, SlickMainPlugin } from '../shared/main.ts';
import { resolveSettings, type PluginSettings, type SettingsSchema } from '../shared/settings.ts';
import { record, type StorageArea } from './rpc.ts';

export const SLACK_INITIATORS = ['app.slack.com'];
export const MAIN_STORAGE_PREFIX = 'slick:firefox:main:';
const MAIN_STORAGE_MAX = 1024 * 1024;

export type BrowserNet = {
  /** Match patterns (`*://host/path*`); optionally only for some request types. */
  block(patterns: string[], options?: { resourceTypes?: string[] }): () => void;
  /** Lets one exact URL past every block for `ms`; resolves once the rule is live. */
  allowOnce(url: string, ms: number): Promise<void>;
  fetch(url: string, init?: RequestInit): Promise<{ status: number; body: string }>;
};

export type BrowserCtx = Pick<MainCtx, 'id' | 'settings' | 'onSettingsChange' | 'log' | 'storage'> & {
  net: BrowserNet;
};

/** A Firefox-specific privileged half (a plugin's browser.ts), for when main.ts can't run as is. */
export type SlickBrowserPlugin = {
  id: string;
  capabilities: Capability[];
  ready?(ctx: BrowserCtx): void | (() => void) | Promise<void | (() => void)>;
  rpc?: Record<string, (ctx: BrowserCtx, args: unknown[]) => unknown>;
};

export type BackgroundPlugin = {
  plugin: SlickMainPlugin | SlickBrowserPlugin;
  schema: SettingsSchema;
  defaultEnabled: boolean;
};

type Rule = {
  id: number;
  priority: number;
  action: { type: 'block' | 'allow' };
  condition: {
    urlFilter?: string;
    regexFilter?: string;
    resourceTypes?: string[];
    initiatorDomains: string[];
    excludedTabIds?: number[];
  };
};

export type Dnr = {
  getSessionRules(): Promise<{ id: number }[]>;
  updateSessionRules(options: { addRules?: Rule[]; removeRuleIds?: number[] }): Promise<void>;
};

/** `*://*.host/path*` → a urlFilter. `||host` already covers subdomains. */
export function patternToFilter(pattern: string): string {
  const match = /^(?:\*|https?):\/\/(?:\*\.)?([a-z0-9.-]+)(\/[^*]*)\*$/i.exec(pattern);
  if (!match) throw new Error(`unsupported match pattern: ${pattern}`);
  return `||${match[1].toLowerCase()}${match[2]}`;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Session rules, re-sent whole on every change so excluded tabs stay in sync. */
function createRules(dnr: Dnr | undefined) {
  const rules = new Map<number, Omit<Rule, 'id'>>();
  const exempt = new Set<number>();
  let nextId = 1;
  let queue = Promise.resolve();

  function sync() {
    if (!dnr) return queue;
    queue = queue
      .then(async () => {
        const existing = (await dnr.getSessionRules()).map((rule) => rule.id);
        const excludedTabIds = exempt.size ? [...exempt] : undefined;
        const addRules = [...rules].map(([id, rule]) => ({
          id,
          ...rule,
          condition: { ...rule.condition, ...(excludedTabIds && { excludedTabIds }) },
        }));
        await dnr.updateSessionRules({ removeRuleIds: existing, addRules });
      })
      .catch((error) => console.error('[slick] could not update request rules:', error));
    return queue;
  }

  return {
    /** `applied` settles once Firefox has the rule. */
    add(rule: Omit<Rule, 'id'>): { dispose: () => void; applied: Promise<void> } {
      const id = nextId++;
      rules.set(id, rule);
      return {
        applied: sync(),
        dispose: () => {
          if (rules.delete(id)) void sync();
        },
      };
    },
    /** Safe-mode and bypassed tabs load Slack without Slick's request rules. */
    setExempt(tabId: number, isExempt: boolean) {
      if (isExempt === exempt.has(tabId)) return;
      if (isExempt) exempt.add(tabId);
      else exempt.delete(tabId);
      void sync();
    },
    /** Rules from a previous (suspended) instance of the event page. */
    reset: sync,
  };
}

function createStorage(area: StorageArea, id: string): MainCtx['storage'] {
  const key = MAIN_STORAGE_PREFIX + id;
  let tail: Promise<unknown> = Promise.resolve();
  const load = async (): Promise<Record<string, string>> => {
    const stored = (await area.get(key))[key];
    return Object.assign(Object.create(null), record(stored) ? stored : {});
  };
  const mutate = (change: (blobs: Record<string, string>) => void) => {
    const run = tail.then(async () => {
      const blobs = await load();
      change(blobs);
      if (JSON.stringify(blobs).length > MAIN_STORAGE_MAX) throw new Error(`${id} storage quota exceeded`);
      await area.set({ [key]: blobs });
      return true;
    });
    tail = run.catch(() => {});
    return run;
  };
  return {
    list: async () => Object.keys(await load()),
    readAll: async (prefix = '') =>
      Object.fromEntries(Object.entries(await load()).filter(([name]) => name.startsWith(prefix))),
    read: async (name) => (await load())[name] ?? null,
    write: (name, value) => mutate((blobs) => void (blobs[name] = String(value))),
    delete: (name) => mutate((blobs) => void delete blobs[name]),
    clear: () => mutate((blobs) => Object.keys(blobs).forEach((name) => delete blobs[name])),
  };
}

type Entry = BackgroundPlugin & {
  settings: PluginSettings;
  listeners: Set<(settings: PluginSettings) => void>;
  ctx: BrowserCtx;
  running: boolean;
  dispose: (() => void | Promise<void>) | null;
  queue: Promise<void>;
};

export function createMainHost(area: StorageArea, dnr: Dnr | undefined, plugins: BackgroundPlugin[]) {
  const rules = createRules(dnr);
  const entries = new Map<string, Entry>();
  let globallyEnabled = true;

  for (const definition of plugins) {
    const { plugin } = definition;
    const need = (capability: Capability) => {
      if (!plugin.capabilities.includes(capability))
        throw new Error(`[slick] ${plugin.id} used "${capability}" without declaring it`);
    };
    const unavailable = (name: string) => () => {
      throw new Error(`[slick] ${plugin.id}: ctx.${name} is unavailable in Firefox; add a browser.ts`);
    };
    const entry = {
      ...definition,
      settings: resolveSettings(definition.schema, definition.defaultEnabled, undefined),
      listeners: new Set(),
      running: false,
      dispose: null,
      queue: Promise.resolve(),
    } as unknown as Entry;
    entry.ctx = {
      id: plugin.id,
      get settings() {
        return entry.settings;
      },
      onSettingsChange(cb) {
        entry.listeners.add(cb);
        return () => void entry.listeners.delete(cb);
      },
      log: (...args) => console.log(`[slick] [${plugin.id}]`, ...args),
      storage: createStorage(area, plugin.id),
      net: {
        block(patterns, options) {
          need('requests');
          const disposers = [...new Set(patterns.map(patternToFilter))].map(
            (urlFilter) =>
              rules.add({
                priority: 1,
                action: { type: 'block' },
                condition: {
                  urlFilter,
                  initiatorDomains: SLACK_INITIATORS,
                  ...(options?.resourceTypes && { resourceTypes: options.resourceTypes }),
                },
              }).dispose,
          );
          return () => disposers.forEach((dispose) => dispose());
        },
        async allowOnce(url, ms) {
          need('requests');
          const { dispose, applied } = rules.add({
            priority: 2,
            action: { type: 'allow' },
            condition: { regexFilter: `^${escapeRegex(url)}$`, initiatorDomains: SLACK_INITIATORS },
          });
          setTimeout(dispose, ms);
          await applied;
        },
        async fetch(url, init) {
          need('net');
          const response = await fetch(url, init);
          return { status: response.status, body: await response.text() };
        },
      },
    };
    // main.ts halves see the MainCtx shape; the parts Firefox can't offer fail loudly.
    Object.assign(entry.ctx, {
      emit: () => {},
      emitTo: () => {},
      protocol: { register: unavailable('protocol.register') },
      frames: { onFrame: unavailable('frames.onFrame') },
      notifications: { filter: unavailable('notifications.filter') },
      media: { onDisplayMediaRequest: unavailable('media.onDisplayMediaRequest') },
      switches: { append: unavailable('switches.append') },
      shell: { openExternal: unavailable('shell.openExternal') },
      dialog: { openFile: unavailable('dialog.openFile') },
      cookies: {
        get: unavailable('cookies.get'),
        set: unavailable('cookies.set'),
        remove: unavailable('cookies.remove'),
      },
      secrets: {
        read: unavailable('secrets.read'),
        write: unavailable('secrets.write'),
        delete: unavailable('secrets.delete'),
      },
    });
    (entry.ctx.net as Record<string, unknown>).intercept = unavailable('net.intercept');
    entries.set(plugin.id, entry);
  }

  const active = (entry: Entry) => globallyEnabled && entry.settings.enabled === true;

  async function start(entry: Entry) {
    if (entry.running || !active(entry)) return;
    try {
      const dispose = await (entry.plugin.ready as (ctx: BrowserCtx) => unknown)?.(entry.ctx);
      entry.dispose = typeof dispose === 'function' ? (dispose as () => void) : null;
      entry.running = true;
    } catch (error) {
      console.error(`[slick] ${entry.plugin.id} ready failed:`, error);
    }
  }

  async function stop(entry: Entry) {
    if (!entry.running) return;
    entry.running = false;
    try {
      await entry.dispose?.();
    } catch (error) {
      console.error(`[slick] ${entry.plugin.id} dispose failed:`, error);
    }
    entry.dispose = null;
    entry.listeners.clear();
  }

  const reconcile = (entry: Entry) =>
    (entry.queue = entry.queue.then(() => (active(entry) ? start(entry) : stop(entry))));

  return {
    reset: rules.reset,
    setExempt: rules.setExempt,

    /** Like desktop updateSettings: start or stop on enablement, else notify running halves. */
    update(stored: unknown) {
      const config = record(stored) ? stored : {};
      const saved = record(config.plugins) ? config.plugins : {};
      globallyEnabled = config.enabled !== false;
      for (const entry of entries.values()) {
        const own = saved[entry.plugin.id];
        entry.settings = resolveSettings(entry.schema, entry.defaultEnabled, record(own) ? own : undefined);
        // Compared with what's running, not the last settings: nothing runs before the first update.
        if (active(entry) !== entry.running) void reconcile(entry);
        else if (active(entry) && entry.running)
          for (const listener of entry.listeners) {
            try {
              listener(entry.settings);
            } catch (error) {
              console.error(`[slick] ${entry.plugin.id} settings listener threw:`, error);
            }
          }
      }
      return Promise.all([...entries.values()].map((entry) => entry.queue));
    },

    async call(id: string, method: string, args: unknown[]): Promise<unknown> {
      const entry = entries.get(id);
      if (!entry) throw new Error(`no background half for ${id}`);
      await entry.queue;
      if (!active(entry) || !entry.running) throw new Error(`${id} is disabled`);
      const rpc = entry.plugin.rpc ?? {};
      // Own properties only, so "constructor"/"toString" don't resolve via the prototype.
      if (!Object.hasOwn(rpc, method)) throw new Error(`unknown method: ${id}.${method}`);
      return (rpc[method] as (ctx: BrowserCtx, args: unknown[]) => unknown)(entry.ctx, args);
    },

    running: (id: string) => entries.get(id)?.running === true,
  };
}
