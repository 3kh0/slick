type Factories = Record<string, () => Promise<unknown>>;
type APIs<F extends Factories> = { [K in keyof F]: Awaited<ReturnType<F[K]>> };

/** Share discoveries, but only start and await the APIs a plugin declares. */
export function createAPILoader<F extends Factories>(factories: F) {
  const pending = new Map<keyof F, Promise<unknown>>();
  const loaded = new Map<keyof F, unknown>();
  return async (required: readonly (keyof F)[]): Promise<APIs<F>> => {
    const allowed = new Set(required);
    await Promise.all(
      [...allowed].map((key) => {
        if (!Object.hasOwn(factories, key)) throw new Error(`Unknown plugin API: ${String(key)}`);
        let promise = pending.get(key);
        if (!promise) {
          promise = Promise.resolve()
            .then(factories[key])
            .then((value) => {
              loaded.set(key, value);
              return value;
            });
          pending.set(key, promise);
        }
        return promise;
      }),
    );
    const api = {} as APIs<F>;
    for (const key of Object.keys(factories)) {
      Object.defineProperty(api, key, {
        enumerable: true,
        get() {
          if (!allowed.has(key)) throw new Error(`Plugin must declare requiredAPIs: ${key}`);
          return loaded.get(key);
        },
      });
    }
    return api;
  };
}
