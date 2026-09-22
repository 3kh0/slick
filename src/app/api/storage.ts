// Slick Plugin Storage
//
// Durable, plugin-scoped, JSON-shaped storage backed by the main process.
// v1's plugins each used raw localStorage, which is per-origin rather than
// per-plugin, survives uninstall, is invisible to Preferences, and silently
// truncates at a few megabytes. This is namespaced and enumerable instead.

export type BlobStore = {
  list(): Promise<string[]>;
  read(key: string): Promise<string | null>;
  /** Every value whose key starts with `prefix`, in one round trip. */
  readAll(prefix?: string): Promise<Record<string, string>>;
  write(key: string, value: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<boolean>;
};

export class ScopedStorage {
  // Written out rather than declared as constructor parameter properties:
  // node --experimental-strip-types cannot parse those, and the tests run
  // under it.
  private blob: BlobStore;

  constructor(blob: BlobStore) {
    this.blob = blob;
  }

  keys(): Promise<string[]> {
    return this.blob.list().catch(() => []);
  }

  /** Every stored value under `prefix`, already parsed; unreadable ones are skipped. */
  async entries<T>(prefix = ''): Promise<Map<string, T>> {
    const raw = await this.blob.readAll(prefix).catch(() => ({}) as Record<string, string>);
    const out = new Map<string, T>();
    for (const [key, value] of Object.entries(raw)) {
      try {
        out.set(key, JSON.parse(value) as T);
      } catch {}
    }
    return out;
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
  private swept = false;
  private sinceSweep = 0;

  private storage: ScopedStorage;
  private name: string;
  private ttlMs: number;
  /**
   * How many entries to hold in memory. A TTL alone is not a bound: it says
   * when an entry stops being *useful*, not when it stops being *resident*.
   * ShowRealUser keys this per message, so without a ceiling the map grows
   * for as long as the session lasts.
   */
  private maxEntries: number;

  constructor(storage: ScopedStorage, name: string, ttlMs = 60 * 60 * 1000, maxEntries = 5000) {
    this.storage = storage;
    this.name = name;
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  private storageKey(key: string) {
    return `cache:${this.name}:${key}`;
  }

  /**
   * Drop what has expired, and whatever is over the ceiling after that.
   *
   * Reading an expired entry only ever overwrote it, so a key that is never
   * asked for again stayed resident for the life of the session and on disk
   * for the life of the install. Maps iterate in insertion order, which is
   * close enough to least-recently-added for a cache of this kind.
   */
  private prune() {
    // `get` is on the render path for ShowRealUser and WhoReacted, so a full
    // scan per call would cost more than the entries it reclaims. Amortise it.
    if (++this.sinceSweep < 512) return;
    this.sinceSweep = 0;
    const now = Date.now();
    for (const [key, entry] of this.memory) if (entry.expires <= now) this.memory.delete(key);
  }

  /** Costs only what it evicts, so it can run on every insert and keep `maxEntries` exact. */
  private remember(key: string, entry: { value: T; expires: number }) {
    this.memory.set(key, entry);
    for (const oldest of this.memory.keys()) {
      if (this.memory.size <= this.maxEntries) break;
      this.memory.delete(oldest);
    }
  }

  /**
   * Delete expired blobs. Runs once per session, on first use rather than on
   * construction so it never competes with boot, and is never awaited: a cache
   * that cannot tidy up is still a working cache.
   */
  private async sweepStorage() {
    const prefix = `cache:${this.name}:`;
    const stored = await this.storage.entries<{ expires?: number } | null>(prefix);
    const now = Date.now();
    for (const [key, entry] of stored) {
      if (entry && typeof entry.expires === 'number' && entry.expires > now) continue;
      void this.storage.delete(key);
    }
  }

  private sweepOnce() {
    if (this.swept) return;
    this.swept = true;
    void this.sweepStorage().catch((error) => console.error(`[slick] cache sweep failed (${this.name}):`, error));
  }

  async get(key: string, fetcher: (key: string) => Promise<T>): Promise<T> {
    const now = Date.now();
    this.sweepOnce();
    this.prune();

    const hit = this.memory.get(key);
    if (hit && hit.expires > now) return hit.value;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const load = (async () => {
      const stored = await this.storage.get<{ value: T; expires: number } | null>(this.storageKey(key), null);
      if (stored && stored.expires > now) {
        this.remember(key, stored);
        return stored.value;
      }

      const value = await fetcher(key);
      const entry = { value, expires: Date.now() + this.ttlMs };
      this.remember(key, entry);
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
