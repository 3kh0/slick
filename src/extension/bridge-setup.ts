// MUST remain type-only: importing bridge.ts here would claim before installation.
import type { SlickBridge } from '../app/bridge.ts';
import { CHANNEL, MAX_TEXT, createClient, namespace, record } from './rpc.ts';

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
    openFile: denied,
    fetch: denied,
    plugin: () => ({ call: denied, on: () => () => {} }),
    blobStore: (id) => {
      if (!namespace(id)) throw new Error('Unsupported renderer namespace');
      return {
        list: () => client.call('blob.list', id),
        read: (key) => client.call('blob.read', id, key),
        readAll: (prefix = '') => client.call('blob.readAll', id, prefix),
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
