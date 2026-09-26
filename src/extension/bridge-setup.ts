// MUST remain type-only: importing bridge.ts here would claim before installation.
import type { SlickBridge } from '../app/bridge.ts';
import { writeStoredFile } from '../app/api/storedFiles.ts';
import { BACKGROUND_PLUGINS } from './plugins.ts';
import { CHANNEL, MAX_TEXT, PAGE_KEYS, createClient, namespace, record } from './rpc.ts';

export function oneShot<T>(value: T): () => T | null {
  let claimed = false;
  return () => {
    if (claimed) return null;
    claimed = true;
    return value;
  };
}
export function installBridge(target: Window & typeof globalThis) {
  if (
    target.top !== target ||
    target.location.origin !== 'https://app.slack.com' ||
    !/^\/client(\/|$)/.test(target.location.pathname)
  )
    return;
  let safeMode = false;
  try {
    if (target.sessionStorage.getItem('slick:firefox:bypass') === '1') return;
    safeMode = target.sessionStorage.getItem('slick:firefox:safe-mode') === '1';
  } catch {
    return;
  } // Fail closed when the bypass preference cannot be read.
  if ('SlickBridge' in target) return;
  const client = createClient((m) => target.postMessage(m, target.location.origin));
  const settings = new Set<(text: string) => void>();
  const css = new Set<(text: string) => void>();
  target.addEventListener('message', (event) => {
    if (event.source !== target || event.origin !== target.location.origin) return;
    client.receive(event.data);
    const m: unknown = event.data;
    if (
      !record(m) ||
      m.channel !== CHANNEL ||
      m.kind !== 'change' ||
      typeof m.value !== 'string' ||
      m.value.length > MAX_TEXT
    )
      return;
    const listeners = m.event === 'settings' ? settings : m.event === 'css' ? css : [];
    for (const notify of listeners) {
      try {
        notify(m.value);
      } catch {}
    }
  });
  // A bfcache page keeps its bridge and pending requests. The isolated relay
  // resyncs settings/CSS on persisted pageshow; a real unload closes the client.
  target.addEventListener('pagehide', (event) => {
    if (!event.persisted) client.disconnect();
  });
  const denied = () => Promise.reject(new Error('Unavailable in Firefox MVP'));
  const bridge: SlickBridge = {
    loader: 'extension',
    loaderVersion: 'mvp',
    bridgeVersion: 1,
    safeMode,
    paths: {},
    readSettings: () => client.call('readSettings'),
    writeSettings: (text) => client.call('writeSettings', text),
    compareAndSwapSettings: (prior, text) => client.call('compareAndSwapSettings', prior, text),
    onSettingsChange: (cb) => {
      settings.add(cb);
      return () => {
        settings.delete(cb);
      };
    },
    readUserCss: () => client.call('readUserCss'),
    writeUserCss: (text) => client.call('writeUserCss', text),
    onUserCssChange: (cb) => {
      css.add(cb);
      return () => {
        css.delete(cb);
      };
    },
    openCssEditor: () => Promise.reject(new Error('Use the Slick toolbar to open options')),
    openFile(_title, accept, owner) {
      if (!owner || !namespace(`plugin:${owner.plugin}`)) return denied();
      const input = target.document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      const picked = new Promise<File | null>((resolve) => {
        input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
        input.addEventListener('cancel', () => resolve(null), { once: true });
      });
      input.click();
      return picked.then((file) =>
        file ? writeStoredFile(bridge.blobStore(`plugin:${owner.plugin}`), owner.setting, file) : '',
      );
    },
    fetch: denied,
    // Privileged halves run in the background (extension/mainHost.ts); events aren't bridged.
    plugin: (id) => ({
      call: async <T>(method: string, ...args: unknown[]) => {
        if (!(BACKGROUND_PLUGINS as readonly string[]).includes(id)) return denied();
        return JSON.parse(await client.call<string>('plugin.call', id, method, JSON.stringify(args))) as T;
      },
      on: () => () => {},
    }),
    blobStore: (id) => {
      if (!namespace(id)) throw new Error('Unsupported renderer namespace');
      const last = (keys: string[]) => keys.reduce((a, b) => (b > a ? b : a));
      return {
        async list() {
          const keys: string[] = [];
          for (let cursor = ''; ;) {
            const page = await client.call<string[]>('blob.list', id, cursor);
            keys.push(...page);
            if (page.length < PAGE_KEYS) return keys;
            cursor = last(page);
          }
        },
        read: (key) => client.call('blob.read', id, key),
        async readAll(prefix = '') {
          const entries: [string, string][] = [];
          for (let cursor = ''; ;) {
            const page = Object.entries(await client.call<Record<string, string>>('blob.readAll', id, prefix, cursor));
            if (!page.length) return Object.fromEntries(entries);
            entries.push(...page);
            cursor = last(page.map(([key]) => key));
          }
        },
        write: (key, value) => client.call('blob.write', id, key, value),
        delete: (key) => client.call('blob.delete', id, key),
        clear: () => client.call('blob.clear', id),
      };
    },
  };
  Object.defineProperty(target, 'SlickBridge', {
    value: Object.freeze({ claim: oneShot(Object.freeze(bridge)) }),
    configurable: false,
    writable: false,
  });
}
if (typeof window !== 'undefined') installBridge(window);
