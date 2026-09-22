// Durable, plugin-scoped JSON storage backed by the main process.

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
  // Not a constructor parameter property: node --experimental-strip-types (tests) can't parse those.
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

/** A TTL cache over plugin storage that de-duplicates in-flight fetches per key. */
export class Cache<T> {
  private memory = new Map<string, { value: T; expires: number }>();
  private inflight = new Map<string, Promise<T>>();
  private swept = false;
  private sinceSweep = 0;

  private storage: ScopedStorage;
  private name: string;
  private ttlMs: number;
  /** In-memory ceiling; a TTL alone doesn't bound residency (ShowRealUser keys per message). */
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

  private prune() {
    // `get` is on render paths; amortise the scan.
    if (++this.sinceSweep < 512) return;
    this.sinceSweep = 0;
    const now = Date.now();
    for (const [key, entry] of this.memory) if (entry.expires <= now) this.memory.delete(key);
  }

  /** Evicts oldest-inserted first; cheap enough to run on every insert. */
  private remember(key: string, entry: { value: T; expires: number }) {
    this.memory.set(key, entry);
    for (const oldest of this.memory.keys()) {
      if (this.memory.size <= this.maxEntries) break;
      this.memory.delete(oldest);
    }
  }

  /** Once per session on first use (not construction, to stay off boot); never awaited. */
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
