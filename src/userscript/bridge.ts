import type { SlickBridge } from '../app/bridge.ts';
import { writeStoredFile } from '../app/api/storedFiles.ts';
import type { BackgroundPlugin } from '../extension/mainHost.ts';
import { createMainHost } from '../extension/mainHost.ts';
import type { StorageArea } from '../extension/rpc.ts';
import { serialQueue } from '../shared/queue.ts';
import { cssEditor } from './cssEditor.ts';
import type { GMApi } from './gm.ts';
import { gmFetch } from './network.ts';
import { CSS, PREFIX, SETTINGS, createBlobStore, validSettings } from './storage.ts';
import { USERSCRIPT_PLUGINS } from './plugins.ts';

export const DEFAULT_SETTINGS = JSON.stringify({
  plugins: Object.fromEntries(USERSCRIPT_PLUGINS.map((id) => [id, { enabled: false }])),
});
export const BYPASS = 'slick:userscript:bypass';
export const SAFE_MODE = 'slick:userscript:safe-mode';

export function createUserscriptBridge(gm: GMApi, plugins: BackgroundPlugin[] = [], safeMode = false): SlickBridge {
  const enqueue = serialQueue();
  const parse = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  };
  const area: StorageArea = {
    get: async (keys) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((key) => [key, gm.get(PREFIX + 'main:' + key, undefined)]),
      ),
    remove: async (keys) => {
      await Promise.all((Array.isArray(keys) ? keys : [keys]).map((key) => gm.delete(PREFIX + 'main:' + key)));
    },
    set: async (values) => {
      await Promise.all(Object.entries(values).map(([key, value]) => gm.set(PREFIX + 'main:' + key, value)));
    },
  };
  const host = createMainHost(area, undefined, plugins, (url, init) => gmFetch(gm, url, init));
  const updateHost = (text: string) => host.update(safeMode ? { enabled: false } : parse(text));
  const hostReady = updateHost(gm.get(SETTINGS, DEFAULT_SETTINGS));
  gm.watch(SETTINGS, (_key, _old, value) => {
    if (typeof value === 'string' && validSettings(value)) void updateHost(value);
  });
  const bridge: SlickBridge = {
    loader: 'userscript',
    loaderVersion: 'violentmonkey',
    bridgeVersion: 1,
    safeMode,
    paths: {},
    readSettings: async () => gm.get(SETTINGS, DEFAULT_SETTINGS),
    writeSettings: (text) =>
      enqueue(async () => {
        if (!validSettings(text)) return false;
        await gm.set(SETTINGS, text);
        await updateHost(text);
        return true;
      }),
    onSettingsChange: (callback) => {
      const id = gm.watch(SETTINGS, (_key, _old, value) => {
        if (typeof value === 'string') callback(value);
      });
      return () => gm.unwatch(id);
    },
    readUserCss: async () => gm.get(CSS, ''),
    writeUserCss: async (css) => {
      await gm.set(CSS, css);
      return true;
    },
    onUserCssChange: (callback) => {
      const id = gm.watch(CSS, (_key, _old, value) => callback(typeof value === 'string' ? value : ''));
      return () => gm.unwatch(id);
    },
    openCssEditor: async () => false,
    openFile(_title, accept, owner) {
      if (!owner || !USERSCRIPT_PLUGINS.includes(owner.plugin as (typeof USERSCRIPT_PLUGINS)[number])) {
        return Promise.reject(new Error('Unsupported file owner'));
      }
      const picker = document.createElement('input');
      picker.type = 'file';
      if (accept) picker.accept = accept;
      const selected = new Promise<File | null>((resolve) => {
        picker.addEventListener('change', () => resolve(picker.files?.[0] ?? null), { once: true });
        picker.addEventListener('cancel', () => resolve(null), { once: true });
      });
      picker.click();
      return selected.then((file) =>
        file ? writeStoredFile(bridge.blobStore(`plugin:${owner.plugin}`), owner.setting, file) : '',
      );
    },
    blobStore: (id) => createBlobStore(gm, id),
    fetch: (url, init) => gmFetch(gm, url, init),
    plugin: (id) => ({
      call: async <T>(method: string, ...args: unknown[]) => {
        await hostReady;
        return (await host.call(id, method, args)) as T;
      },
      on: () => () => {},
    }),
  };
  bridge.openCssEditor = cssEditor(bridge);
  return bridge;
}

export function installUserscriptBridge(
  target: Window & typeof globalThis,
  gm: GMApi,
  plugins: BackgroundPlugin[] = [],
) {
  if (
    target.top !== target ||
    target.location.origin !== 'https://app.slack.com' ||
    !/^\/client(\/|$)/.test(target.location.pathname)
  )
    return;
  // Register recovery even when bypassed, or the user cannot turn Slick back on.
  gm.menu('Toggle Slick bypass and reload', () => {
    if (target.sessionStorage.getItem(BYPASS) === '1') target.sessionStorage.removeItem(BYPASS);
    else target.sessionStorage.setItem(BYPASS, '1');
    target.location.reload();
  });
  gm.menu('Toggle Slick safe mode and reload', () => {
    if (target.sessionStorage.getItem(SAFE_MODE) === '1') target.sessionStorage.removeItem(SAFE_MODE);
    else target.sessionStorage.setItem(SAFE_MODE, '1');
    target.location.reload();
  });
  if (target.sessionStorage.getItem(BYPASS) === '1') return;
  if ('SlickBridge' in target) {
    console.warn('[slick] Another Slick loader is active. Disable the extension before using the userscript.');
    return;
  }
  const bridge = createUserscriptBridge(gm, plugins, target.sessionStorage.getItem(SAFE_MODE) === '1');
  let claimed = false;
  Object.defineProperty(target, 'SlickBridge', {
    configurable: false,
    writable: false,
    value: Object.freeze({
      claim: () => {
        if (claimed) return null;
        claimed = true;
        return Object.freeze(bridge);
      },
    }),
  });
}
