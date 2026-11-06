import type { BlobStore } from '../app/api/storage.ts';
import type { GMApi } from './gm.ts';

export const PREFIX = 'slick:userscript:v2:';
export const SETTINGS = PREFIX + 'settings';
export const CSS = PREFIX + 'css';

export function createBlobStore(gm: GMApi, namespace: string): BlobStore {
  if (!/^(?:plugin:[A-Za-z][A-Za-z0-9]*|core:[a-z][a-z0-9-]*)$/.test(namespace)) {
    throw new Error('Invalid storage namespace');
  }
  const prefix = PREFIX + 'blob:' + namespace + ':';
  const list = () =>
    gm
      .list()
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  return {
    list: async () => list(),
    read: async (key) => gm.get<string | null>(prefix + key, null),
    readAll: async (start = '') =>
      Object.fromEntries(
        list()
          .filter((key) => key.startsWith(start))
          .map((key) => [key, gm.get(prefix + key, '')]),
      ),
    write: async (key, value) => {
      await gm.set(prefix + key, value);
      return true;
    },
    delete: async (key) => {
      await gm.delete(prefix + key);
      return true;
    },
    clear: async () => {
      await Promise.all(list().map((key) => gm.delete(prefix + key)));
      return true;
    },
  };
}

// JSON objects only; malformed imports must never overwrite working settings.
export function validSettings(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  } catch {
    return false;
  }
}
