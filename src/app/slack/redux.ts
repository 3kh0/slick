// Slick Redux Interception
//
// Read-time state patching. Rather than dispatching actions to change what
// Slack believes, Slick wraps `getState` so a plugin can transform entries as
// they are read -- a nickname, a censored message, a channel Slack cannot see.
// Slack's own state is never mutated, so disabling a plugin restores the truth
// immediately.
//
// v1 had six plugins each rediscovering the store and hand-rolling their own
// getState wrapper; this is the one copy.

import { getFiberFromNode, reactReady } from './react.tsx';
import { patchExportFunction, patchModuleExports } from './webpack.ts';

export type SlackStore = {
  getState(): any;
  dispatch(action: any): any;
  subscribe(cb: () => void): () => void;
};

export type StatePatch = (state: any) => any;

const statePatches = new Set<StatePatch>();
/** Bumped whenever patches change, to invalidate every memo keyed on it. */
let patchVersion = 0;

type WrappedGetState = (() => any) & { __slickWrapped?: true; __slickRawGetState?: () => any };

function wrapGetState(store: SlackStore): void {
  if ((store.getState as WrappedGetState).__slickWrapped) return;

  const rawGetState = store.getState.bind(store);
  let cachedRaw: any;
  let cachedVersion = -1;
  let cachedOut: any;

  const wrapped: WrappedGetState = () => {
    const raw = rawGetState();
    if (statePatches.size === 0) return raw;
    if (raw === cachedRaw && cachedVersion === patchVersion) return cachedOut;

    let out = raw;
    for (const patch of statePatches) {
      try {
        out = patch(out);
      } catch (error) {
        console.error('[slick] state patch threw:', error);
      }
    }
    cachedRaw = raw;
    cachedVersion = patchVersion;
    cachedOut = out;
    return out;
  };

  wrapped.__slickWrapped = true;
  wrapped.__slickRawGetState = rawGetState;
  store.getState = wrapped;
}

// Catch stores at creation, so patches are in place before Slack reads state.
patchExportFunction('createStore', (originalCreateStore) => (...args: any[]) => {
  const store = originalCreateStore(...args);
  try {
    wrapGetState(store);
  } catch {}
  // A new store may be about to replace the Provider's; look again next time.
  cachedStore = null;
  return store;
});

/** The Provider's store once found. Cleared whenever Slack creates a new one. */
let cachedStore: SlackStore | null = null;

/**
 * Slack's store, found through the <Provider> value on the fiber tree. The
 * walk runs once per store: it used to run on every call, and hooks, thunks
 * and a 500ms poll all call this.
 */
export function getStore(): SlackStore | null {
  if (cachedStore) return cachedStore;
  const start = document.querySelector('.p-client_container')?.firstElementChild;
  if (!start) return null;

  for (let fiber = getFiberFromNode(start); fiber; fiber = fiber.return) {
    const value = fiber.memoizedProps?.value;
    const store = value?.store ?? value;
    if (store && typeof store.getState === 'function' && typeof store.subscribe === 'function') {
      cachedStore = store;
      return store;
    }
  }
  return null;
}

const storeListeners = new Set<() => void>();
let storePoll: ReturnType<typeof setInterval> | undefined;
let observedStore: SlackStore | null = null;

function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener);
  if (!storePoll) {
    observedStore = getStore();
    storePoll = setInterval(() => {
      const store = getStore();
      if (store === observedStore) return;
      observedStore = store;
      for (const notify of storeListeners) notify();
    }, 500);
  }
  return () => {
    storeListeners.delete(listener);
    if (storeListeners.size || !storePoll) return;
    clearInterval(storePoll);
    storePoll = undefined;
  };
}

/** Slack's state as Slack stores it, with Slick's transforms left off. */
export function getRawState(): any {
  const getState = getStore()?.getState as WrappedGetState | undefined;
  return (getState?.__slickRawGetState ?? getState)?.();
}

const patchListeners = new Set<() => void>();
const subscribePatches = (notify: () => void) => {
  patchListeners.add(notify);
  return () => void patchListeners.delete(notify);
};
export const getPatchVersion = () => patchVersion;

/**
 * Invalidate patched reads and nudge connected views to re-read. Any live
 * settings change that a slice patch depends on must call this, or the
 * patch closure keeps serving memoized results from the old settings.
 */
export function refresh(): void {
  patchVersion++;
  try {
    getStore()?.dispatch({ type: '@@slick/PATCH_STATE' });
  } catch {}
  for (const notify of patchListeners) {
    try {
      notify();
    } catch {}
  }
}

export function patchState(patch: StatePatch): () => void {
  statePatches.add(patch);
  refresh();
  return () => {
    statePatches.delete(patch);
    refresh();
  };
}

// mapEntries
//
// A proxy over one of Slack's id-keyed slices (members, messages, channels)
// that runs each entry through `mapEntry` as it is read. Results are memoized
// per key on the raw value, so an untouched entry costs one Map lookup.
//
// The proxy has to cover get, getOwnPropertyDescriptor, ownKeys and the
// prototype: Slack reads these slices in all of those ways, and `addedKeys`
// (entries that do not exist in Slack's state at all) only materialize if
// ownKeys reports them.

const hasOwn = (object: object, key: PropertyKey): boolean => typeof key !== 'symbol' && Object.hasOwn(object, key);

export type MapEntry<T> = (key: string, entry: T | undefined) => T | undefined;

type Memo = {
  cache: Map<string, { input: any; output: any }>;
  added: Set<string>;
  version: number;
};

const memos = new WeakMap<MapEntry<any>, Memo>();
const failedEntryPatches = new WeakSet<MapEntry<any>>();
const failedAddedKeys = new WeakSet<() => Iterable<string>>();

function memoFor(mapEntry: MapEntry<any>): Memo {
  let memo = memos.get(mapEntry);
  if (!memo) {
    memo = { cache: new Map(), added: new Set(), version: -1 };
    memos.set(mapEntry, memo);
  }
  return memo;
}

export function mapEntries<T = any>(
  object: object,
  mapEntry: MapEntry<T>,
  addedKeys?: () => Iterable<string>,
  patchName = 'anonymous',
): object {
  const memo = memoFor(mapEntry);
  let failed = false;

  // A version bump means the closure's inputs may have changed, so memoized
  // results and the added-key set are dropped.
  const sync = () => {
    if (memo.version === patchVersion) return;
    memo.cache = new Map();
    if (addedKeys && !failedAddedKeys.has(addedKeys)) {
      try {
        memo.added = new Set(addedKeys());
      } catch (error) {
        memo.added = new Set();
        failedAddedKeys.add(addedKeys);
        console.error('[slick] added-keys callback threw; no virtual entries will be enumerated:', addedKeys, error);
      }
    }
    memo.version = patchVersion;
  };

  const run = (key: PropertyKey, value: any): any => {
    if (typeof key !== 'string') return value;
    sync();
    if (failed || failedEntryPatches.has(mapEntry)) return value;
    const hit = memo.cache.get(key);
    if (hit && hit.input === value) return hit.output;
    let output: T | undefined;
    try {
      output = mapEntry(key, value as T | undefined);
    } catch (error) {
      failed = true;
      failedEntryPatches.add(mapEntry);
      memo.cache.clear();
      console.error(`[slick] entry patch "${patchName}" threw for key "${key}" and was disabled:`, mapEntry, error);
      return value;
    }
    memo.cache.set(key, { input: value, output });
    return output;
  };

  const read = (target: object, key: PropertyKey): any => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    const value = (target as any)[key];
    if (
      descriptor &&
      descriptor.configurable === false &&
      (('value' in descriptor && descriptor.writable === false) || (!('value' in descriptor) && !descriptor.get))
    ) {
      return value;
    }
    return run(key, value);
  };

  const hasMapped = (target: object, key: PropertyKey): boolean => {
    if (typeof key !== 'string') return Reflect.has(target, key);
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor && (descriptor.configurable === false || !Object.isExtensible(target))) return true;
    return run(key, (target as any)[key]) !== undefined;
  };

  const describe = (target: object, key: PropertyKey) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor) {
      if (!('value' in descriptor) || descriptor.configurable === false) return descriptor;
      return { ...descriptor, value: run(key, descriptor.value) };
    }
    sync();
    if (typeof key === 'string' && memo.added.has(key) && Object.isExtensible(target)) {
      const value = run(key, undefined);
      if (value !== undefined) return { value, enumerable: true, configurable: true, writable: true };
    }
    return undefined;
  };

  const ownKeysWith = (target: object): (string | symbol)[] => {
    const keys = Reflect.ownKeys(target);
    if (!addedKeys || !Object.isExtensible(target)) return keys;
    sync();
    const extra = [...memo.added].filter((key) => !hasOwn(target, key) && run(key, undefined) !== undefined);
    return extra.length ? [...keys, ...extra] : keys;
  };

  const protoProxies = new WeakMap<object, object>();
  const proxyProto = (proto: object): object => {
    let proxied = protoProxies.get(proto);
    if (!proxied) {
      proxied = new Proxy(proto, {
        get: read,
        has: hasMapped,
        getOwnPropertyDescriptor: describe,
        ownKeys: ownKeysWith,
      });
      protoProxies.set(proto, proxied);
    }
    return proxied;
  };

  return new Proxy(object, {
    get: read,
    has: hasMapped,
    getOwnPropertyDescriptor: (target, key) => {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (!descriptor || !('value' in descriptor) || descriptor.configurable === false) return descriptor;
      return { ...descriptor, value: run(key, descriptor.value) };
    },
    getPrototypeOf: (target) => {
      const proto = Object.getPrototypeOf(target);
      if (!Object.isExtensible(target) || !proto || typeof proto !== 'object' || proto === Object.prototype)
        return proto;
      return proxyProto(proto);
    },
  });
}

// Slice patches
//
// Every patch on one slice shares a single proxy, and that proxy is reused for
// as long as Slack's own slice object is unchanged. Both matter: a fresh proxy
// per state change gave `state.members` a new identity on every dispatch --
// measured at 61 identities over 8s idle against Slack's 3 -- so every selector
// taking a whole slice recomputed on every action, and three plugins patching
// `messages` meant three nested proxies on every message read.

type SlicePatch = { mapEntry: MapEntry<any>; addedKeys?: () => Iterable<string> };
type SliceLayer = {
  patches: Set<SlicePatch>;
  /** Rebuilt whenever `patches` changes, so mapEntries' memo starts clean. */
  mapEntry: MapEntry<any>;
  addedKeys?: () => Iterable<string>;
  raw?: object;
  version: number;
  proxy?: object;
};

const slices = new Map<string, SliceLayer>();
let unpatchSlices: (() => void) | null = null;

function composeLayer(sliceName: string, layer: SliceLayer) {
  const patches = [...layer.patches];
  const failed = new Set<SlicePatch>();
  layer.mapEntry = (key, entry) => {
    let out = entry;
    for (const patch of patches) {
      if (failed.has(patch)) continue;
      try {
        out = patch.mapEntry(key, out);
      } catch (error) {
        // Disable just the patch that threw, not every patch on the slice.
        failed.add(patch);
        console.error(`[slick] entry patch on "${sliceName}" threw for key "${key}" and was disabled:`, error);
      }
    }
    return out;
  };
  const adders = patches.filter((patch) => patch.addedKeys);
  layer.addedKeys = adders.length
    ? function* () {
        for (const patch of adders) {
          try {
            yield* patch.addedKeys!();
          } catch (error) {
            console.error(`[slick] added-keys callback on "${sliceName}" threw:`, error);
          }
        }
      }
    : undefined;
  layer.proxy = undefined;
}

function patchSlices(state: any): any {
  let out = state;
  for (const [sliceName, layer] of slices) {
    const slice = state?.[sliceName];
    if (!slice || typeof slice !== 'object') continue;
    if (layer.raw !== slice || layer.version !== patchVersion || !layer.proxy) {
      layer.raw = slice;
      layer.version = patchVersion;
      layer.proxy = mapEntries(slice, layer.mapEntry, layer.addedKeys, sliceName);
    }
    if (out === state) out = { ...state };
    out[sliceName] = layer.proxy;
  }
  return out;
}

/** Transform entries of one id-keyed slice as they are read. */
export function patchSlice<T = any>(
  sliceName: string,
  mapEntry: MapEntry<T>,
  addedKeys?: () => Iterable<string>,
): () => void {
  const patch: SlicePatch = { mapEntry, addedKeys };
  let layer = slices.get(sliceName);
  if (!layer) {
    layer = { patches: new Set(), mapEntry: (_key, entry) => entry, version: -1 };
    slices.set(sliceName, layer);
  }
  layer.patches.add(patch);
  composeLayer(sliceName, layer);
  if (!unpatchSlices) unpatchSlices = patchState(patchSlices);
  else refresh();

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const current = slices.get(sliceName);
    if (!current?.patches.delete(patch)) return;
    if (current.patches.size) composeLayer(sliceName, current);
    else slices.delete(sliceName);
    if (!slices.size && unpatchSlices) {
      const unpatch = unpatchSlices;
      unpatchSlices = null;
      unpatch();
    } else {
      refresh();
    }
  };
}

// Thunks
//
// Slack builds every thunk and fetcher through one `createThunk` factory, so
// wrapping that factory yields a registry keyed by the thunk's own meta.name --
// which is how plugins address a thunk without knowing its minified module id.

type ThunkCreator = (...args: any[]) => any;
type ThunkWrap = {
  match: (value: any) => boolean;
  wrap: (original: ThunkCreator) => ThunkCreator;
};

const thunkWraps = new Set<ThunkWrap>();
const thunkCreators = new Map<string, ThunkCreator>();
type ThunkWaiter = { resolve: (creator: ThunkCreator) => void; timer: ReturnType<typeof setTimeout> };
const waitingForThunk = new Map<string, Set<ThunkWaiter>>();
const THUNK_WAIT_MS = 30_000;

const wrapCreator = (original: ThunkCreator): ThunkCreator =>
  new Proxy(original, {
    apply(target, thisArg, args) {
      let creator: ThunkCreator = target;
      for (const { match, wrap } of thunkWraps) {
        let matched = false;
        try {
          matched = match(target);
        } catch {}
        if (!matched) continue;
        try {
          creator = wrap(creator);
        } catch (error) {
          console.error('[slick] thunk wrapper threw:', error);
        }
      }
      return Reflect.apply(creator, thisArg, args);
    },
  });

function registerCreator(creator: ThunkCreator): void {
  // The defining module assigns `meta` on the statement *after* createThunk
  // returns, so the name is not readable until the current task yields.
  queueMicrotask(() => {
    const name = (creator as any).meta?.name;
    if (typeof name !== 'string') return;
    thunkCreators.set(name, creator);

    const waiting = waitingForThunk.get(name);
    if (!waiting) return;
    waitingForThunk.delete(name);
    for (const waiter of waiting) {
      clearTimeout(waiter.timer);
      waiter.resolve(creator);
    }
  });
}

const readExport = (exports: any, key: string): any => {
  try {
    return exports[key];
  } catch {
    return undefined;
  }
};

// The module that defines createThunk also exports its kind enum; that pair is
// the most stable signature available for a module whose names are minified.
const isThunkKinds = (value: any): boolean => value?.Thunk === 'Thunk' && value?.Fetcher === 'Fetcher';

patchModuleExports((exports) => {
  if (!exports || typeof exports !== 'object') return;
  const keys = Object.keys(exports);
  if (!keys.some((key) => isThunkKinds(readExport(exports, key)))) return;

  const key = keys.find((candidate) => {
    const value = readExport(exports, candidate);
    return typeof value === 'function' && value.length === 2;
  });
  if (!key) return;

  const createThunk = exports[key] as (...args: any[]) => ThunkCreator;
  const descriptors = Object.getOwnPropertyDescriptors(exports);
  descriptors[key] = {
    value: (...args: any[]) => {
      const creator = wrapCreator(createThunk(...args));
      registerCreator(creator);
      return creator;
    },
    enumerable: true,
    configurable: true,
    writable: true,
  };
  return Object.create(Object.getPrototypeOf(exports), descriptors);
});

export function getThunkCreator(name: string): ThunkCreator | undefined {
  return thunkCreators.get(name);
}

export function waitForThunkCreator(name: string): Promise<ThunkCreator> {
  const known = thunkCreators.get(name);
  if (known) return Promise.resolve(known);

  return new Promise((resolve, reject) => {
    let waiting = waitingForThunk.get(name);
    if (!waiting) {
      waiting = new Set();
      waitingForThunk.set(name, waiting);
    }
    const waiter: ThunkWaiter = {
      resolve,
      timer: setTimeout(() => {
        waiting?.delete(waiter);
        if (waiting?.size === 0) waitingForThunk.delete(name);
        reject(new Error(`[slick] timed out waiting for Slack thunk: ${name}`));
      }, THUNK_WAIT_MS),
    };
    waiting.add(waiter);
  });
}

export async function dispatchThunk<T = any>(name: string, ...args: any[]): Promise<T> {
  const creator = await waitForThunkCreator(name);
  const store = getStore();
  if (!store) throw new Error('[slick] no redux store to dispatch to');
  return store.dispatch(creator(...args));
}

/** Observe or alter one of Slack's thunks. */
export function patchThunk(match: string | ThunkWrap['match'], wrap: ThunkWrap['wrap']): () => void {
  const matcher: ThunkWrap['match'] = typeof match === 'string' ? (value) => value?.meta?.name === match : match;
  const entry: ThunkWrap = { match: matcher, wrap };
  thunkWraps.add(entry);
  return () => void thunkWraps.delete(entry);
}

// Hooks, available once Slack's React has been found.

export const reduxReady = (async () => {
  const React = await reactReady;

  function useReduxState<T>(selector: (state: any) => T): T | undefined {
    const store = React.useSyncExternalStore(subscribeStore, getStore);
    const selectorRef = React.useRef(selector);
    selectorRef.current = selector;

    const subscribe = React.useCallback((cb: () => void) => (store ? store.subscribe(cb) : () => {}), [store]);
    const getSnapshot = React.useCallback(() => (store ? selectorRef.current(store.getState()) : undefined), [store]);
    return React.useSyncExternalStore(subscribe, getSnapshot);
  }

  /**
   * Slack's `connect` memoizes off the raw state, so it never re-runs for a
   * read-time patch. Any component rendering patched data must subscribe to
   * this or it will update only by coincidence.
   */
  function usePatchVersion(): number {
    return React.useSyncExternalStore(subscribePatches, getPatchVersion);
  }

  return {
    getStore,
    getRawState,
    useReduxState,
    usePatchVersion,
    patchState,
    patchSlice,
    mapEntries,
    patchThunk,
    getThunkCreator,
    waitForThunkCreator,
    dispatchThunk,
    refresh,
  };
})();

export type ReduxAPI = Awaited<typeof reduxReady>;

/** Discovery aids; see docs/slack-internals.md. */
export function exposeDebugGlobals() {
  const debug = {
    getStore,
    getRawState,
    getThunkCreator,
    thunkNames: () => [...thunkCreators.keys()],
  };
  for (const [name, value] of Object.entries(debug)) {
    try {
      (globalThis as any)[name] = value;
    } catch (error) {
      console.error(`[slick] could not expose Redux debug global ${name}:`, error);
    }
  }
}
