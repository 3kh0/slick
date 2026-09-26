// Renderer plugins' blob stores, kept in the background's IndexedDB: one record
// per key, so a write doesn't rewrite the whole namespace the way a storage.local
// object would, and logs (MessageLogger, LastSeen) can grow past what fits there.

import { MAX_TEXT, PAGE_KEYS, blobLimits, record } from './rpc.ts';
import type { Request, StorageArea } from './rpc.ts';

/** Where blobs lived before IndexedDB; moved over on first use of each namespace. */
export const BLOB_PREFIX = 'slick:firefox:blobs:';

export type Usage = { keys: number; bytes: number };

export type BlobBackend = {
  get(ns: string, key: string): Promise<string | undefined>;
  // Also keeps the namespace's usage in step, atomically.
  put(ns: string, key: string, value: string): Promise<void>;
  delete(ns: string, key: string): Promise<void>;
  clear(ns: string): Promise<void>;
  usage(ns: string): Promise<Usage>;
  // Up to `count` entries of `ns` in key order, starting at `from` (or just after it).
  range(ns: string, from: string, exclusive: boolean, count: number): Promise<[string, string][]>;
};

const DB_NAME = 'slick';
const BLOBS = 'blobs';
const USAGE = 'usage';

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });

/** Keys are `[namespace, key]`; `[ns, []]` sorts after every string key in `ns`. */
export function indexedDbBackend(factory?: IDBFactory): BlobBackend {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      // Resolved late: tests build a background without IndexedDB and never touch blobs.
      const request = (factory ?? indexedDB).open(DB_NAME, 1);
      request.addEventListener('upgradeneeded', () => {
        request.result.createObjectStore(BLOBS);
        request.result.createObjectStore(USAGE);
      });
      request.addEventListener('success', () => {
        const db = request.result;
        db.addEventListener('versionchange', () => {
          db.close();
          opening = null;
        });
        resolve(db);
      });
      request.addEventListener('error', () => {
        opening = null;
        reject(request.error);
      });
    }));

  /** Resolves with `work`'s result once the transaction commits. */
  async function transact<T>(
    mode: IDBTransactionMode,
    work: (blobs: IDBObjectStore, usage: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const tx = (await open()).transaction([BLOBS, USAGE], mode);
    const committed = new Promise<void>((resolve, reject) => {
      tx.addEventListener('complete', () => resolve());
      const fail = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      tx.addEventListener('error', fail);
      tx.addEventListener('abort', fail);
    });
    // Request callbacks run before the transaction can auto-commit, so chaining
    // them keeps every step inside it.
    const result = work(tx.objectStore(BLOBS), tx.objectStore(USAGE)).catch((error) => {
      try {
        tx.abort();
      } catch {} // Already finished.
      throw error;
    });
    await Promise.all([result, committed]);
    return result;
  }

  const readUsage = async (store: IDBObjectStore, ns: string): Promise<Usage> => {
    const stored: unknown = await done(store.get(ns));
    return record(stored) && typeof stored.keys === 'number' && typeof stored.bytes === 'number'
      ? { keys: stored.keys, bytes: stored.bytes }
      : { keys: 0, bytes: 0 };
  };

  const change = (ns: string, key: string, value: string | undefined) =>
    transact('readwrite', async (blobs, usage) => {
      const prior: unknown = await done(blobs.get([ns, key]));
      const had = typeof prior === 'string';
      const next = await readUsage(usage, ns);
      next.keys += (value === undefined ? 0 : 1) - (had ? 1 : 0);
      next.bytes += (value?.length ?? 0) - (had ? prior.length : 0);
      if (value === undefined) blobs.delete([ns, key]);
      else blobs.put(value, [ns, key]);
      usage.put(next, ns);
    });

  return {
    get: (ns, key) =>
      transact('readonly', async (blobs) => {
        const value: unknown = await done(blobs.get([ns, key]));
        return typeof value === 'string' ? value : undefined;
      }),
    put: (ns, key, value) => change(ns, key, value),
    delete: (ns, key) => change(ns, key, undefined),
    clear: (ns) =>
      transact('readwrite', async (blobs, usage) => {
        blobs.delete(IDBKeyRange.bound([ns, ''], [ns, []]));
        usage.delete(ns);
      }),
    usage: (ns) => transact('readonly', (_blobs, usage) => readUsage(usage, ns)),
    range: (ns, from, exclusive, count) =>
      transact('readonly', async (blobs) => {
        const range = IDBKeyRange.bound([ns, from], [ns, []], exclusive, true);
        const [keys, values] = await Promise.all([
          done(blobs.getAllKeys(range, count)),
          done(blobs.getAll(range, count)),
        ]);
        return keys.map((key, index) => [(key as [string, string])[1], String(values[index])]);
      }),
  };
}

/** Same contract as indexedDbBackend, for tests. */
export function memoryBackend(): BlobBackend & { data: Map<string, Map<string, string>> } {
  const data = new Map<string, Map<string, string>>();
  const space = (ns: string) => data.get(ns) ?? data.set(ns, new Map()).get(ns)!;
  return {
    data,
    get: async (ns, key) => data.get(ns)?.get(key),
    put: async (ns, key, value) => void space(ns).set(key, value),
    delete: async (ns, key) => void data.get(ns)?.delete(key),
    clear: async (ns) => void data.delete(ns),
    usage: async (ns) => {
      const values = [...(data.get(ns)?.values() ?? [])];
      return { keys: values.length, bytes: values.reduce((sum, value) => sum + value.length, 0) };
    },
    range: async (ns, from, exclusive, count) =>
      [...(data.get(ns) ?? [])]
        .filter(([key]) => (exclusive ? key > from : key >= from))
        .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .slice(0, count),
  };
}

/** How many entries readAll pulls from IndexedDB at once; values can be MAX_TEXT each. */
const READ_CHUNK = 32;

export function createBlobs(area: StorageArea, backend: BlobBackend) {
  const migrated = new Set<string>();

  async function migrate(ns: string) {
    if (migrated.has(ns)) return;
    const legacyKey = BLOB_PREFIX + ns;
    const stored = (await area.get(legacyKey))[legacyKey];
    if (record(stored)) {
      // Existing IndexedDB records are newer; a crash mid-way just repeats this next time.
      for (const [key, value] of Object.entries(stored))
        if (key && typeof value === 'string' && (await backend.get(ns, key)) === undefined)
          await backend.put(ns, key, value);
      await area.remove(legacyKey);
    }
    migrated.add(ns);
  }

  /** Entries under `prefix` after `cursor`, bounded to one relayable response. */
  async function readPage(ns: string, prefix: string, cursor: string) {
    const page: [string, string][] = [];
    let size = 0;
    let [from, exclusive] = cursor >= prefix ? [cursor, cursor !== ''] : [prefix, false];
    while (page.length < PAGE_KEYS) {
      const count = Math.min(READ_CHUNK, PAGE_KEYS - page.length);
      const chunk = await backend.range(ns, from, exclusive, count);
      for (const [key, value] of chunk) {
        if (!key.startsWith(prefix)) return page;
        size += key.length + value.length;
        if (size > MAX_TEXT) return page;
        page.push([key, value]);
      }
      if (chunk.length < count) break;
      [from, exclusive] = [chunk.at(-1)![0], true];
    }
    return page;
  }

  return async function execute({ method, args: a }: Request): Promise<unknown> {
    const ns = a[0];
    await migrate(ns);
    switch (method) {
      case 'blob.list':
        return (await backend.range(ns, a[1], a[1] !== '', PAGE_KEYS)).map(([key]) => key);
      case 'blob.read':
        return (await backend.get(ns, a[1])) ?? null;
      case 'blob.readAll':
        // fromEntries defines own properties, so a "__proto__" key stays data.
        return Object.fromEntries(await readPage(ns, a[1], a[2]));
      case 'blob.write': {
        const limits = blobLimits(ns);
        const usage = await backend.usage(ns);
        const prior = await backend.get(ns, a[1]);
        const keys = usage.keys + (prior === undefined ? 1 : 0);
        const bytes = usage.bytes - (prior?.length ?? 0) + a[2].length;
        if (a[2].length > limits.value || keys > limits.keys || bytes > limits.bytes)
          throw new Error('Blob quota exceeded');
        await backend.put(ns, a[1], a[2]);
        return true;
      }
      case 'blob.delete':
        await backend.delete(ns, a[1]);
        return true;
      case 'blob.clear':
        await backend.clear(ns);
        return true;
      default:
        throw new Error('Unsupported storage method');
    }
  };
}
