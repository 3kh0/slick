// Slick Plugin Storage
//
// Durable, plugin-scoped, JSON-shaped storage backed by the main process.
// v1's plugins each used raw localStorage, which is per-origin rather than
// per-plugin, survives uninstall, is invisible to Preferences, and silently
// truncates at a few megabytes. This is namespaced and enumerable instead.

export type BlobStore = {
  list(): Promise<string[]>;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<boolean>;
};

export class ScopedStorage {
  constructor(private blob: BlobStore) {}

  keys(): Promise<string[]> {
    return this.blob.list().catch(() => []);
  }

  async get<T>(key: string, fallback: T): Promise<T> {
    const raw = await this.blob.read(key).catch(() => null);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: unknown): Promise<boolean> {
    let json: string;
    try {
      json = JSON.stringify(value);
    } catch (error) {
      console.error('[slick] value is not serializable:', error);
      return Promise.resolve(false);
    }
    return this.blob.write(key, json).catch(() => false);
  }

  delete(key: string): Promise<boolean> {
    return this.blob.delete(key).catch(() => false);
  }

  clear(): Promise<boolean> {
    return this.blob.clear().catch(() => false);
  }
}

/**
 * A TTL cache over the same storage, with in-flight de-duplication so a hundred
 * simultaneous renders of the same user produce one request rather than a
 * hundred. v1's WhoReacted, HcaStatus and UserPronouns each rolled their own.
 */
export class Cache<T> {
  private memory = new Map<string, { value: T; expires: number }>();
  private inflight = new Map<string, Promise<T>>();

  constructor(
    private storage: ScopedStorage,
    private name: string,
    private ttlMs = 60 * 60 * 1000,
  ) {}

  private storageKey(key: string) {
    return `cache:${this.name}:${key}`;
  }

  async get(key: string, fetcher: (key: string) => Promise<T>): Promise<T> {
    const now = Date.now();

    const hit = this.memory.get(key);
    if (hit && hit.expires > now) return hit.value;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const load = (async () => {
      const stored = await this.storage.get<{ value: T; expires: number } | null>(this.storageKey(key), null);
      if (stored && stored.expires > now) {
        this.memory.set(key, stored);
        return stored.value;
      }

      const value = await fetcher(key);
      const entry = { value, expires: Date.now() + this.ttlMs };
      this.memory.set(key, entry);
      void this.storage.set(this.storageKey(key), entry);
      return value;
    })();

    this.inflight.set(key, load);
    try {
      return await load;
    } finally {
      this.inflight.delete(key);
    }
  }

  /** What is already known, without fetching. Safe to call during a render. */
  peek(key: string): T | undefined {
    const hit = this.memory.get(key);
    return hit && hit.expires > Date.now() ? hit.value : undefined;
  }

  forget(key: string) {
    this.memory.delete(key);
    void this.storage.delete(this.storageKey(key));
  }
}
