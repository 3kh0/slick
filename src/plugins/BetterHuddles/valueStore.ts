// A plain observable value. Slick's `api.Store` needs a plugin instance, and the
// call logic is kept free of the plugin so it can be tested under node:test.

export interface ValueStore<T> {
  get: () => T;
  set: (next: T) => void;
  update: (change: (current: T) => T) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const set = (next: T) => {
    value = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => value,
    set,
    update: (change) => set(change(value)),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
