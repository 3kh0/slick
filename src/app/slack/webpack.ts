// Installs before Slack's bundle evaluates: the chunk-array global becomes an
// accessor so its `push` can be wrapped the moment Slack creates it, and every
// module factory is wrapped as it arrives. Modules register as Slack itself
// initializes them, so Slick never changes load order.

import type { Chunk, Exports, ModuleFactory, WebpackModule, WebpackRequire } from './webpackTypes.ts';

const global = globalThis as any;

let webpackRequire: WebpackRequire | null = null;

const moduleRegistry = new Map<PropertyKey, Exports>();
/** Unwrapped factories, so .toString() is the original source. */
const moduleFactories = new Map<string, ModuleFactory>();
const exportOwners = new WeakMap<object, string>();

function isIndexable(value: any): boolean {
  return !!value && (typeof value === 'object' || typeof value === 'function');
}

function registerExportOwner(moduleId: string, exports: any) {
  if (!isIndexable(exports)) return;
  if (!exportOwners.has(exports)) exportOwners.set(exports, moduleId);
  for (const key in exports) {
    if (!Object.hasOwn(exports, key)) continue;
    try {
      const value = exports[key];
      if (isIndexable(value) && !exportOwners.has(value)) exportOwners.set(value, moduleId);
    } catch {}
  }
}

type SimpleMatcher = (exp: any) => boolean;
type ExportMatcher<T> = (exp: any) => exp is T;

/** Slack exports most things as namespace members, so check each own property too. */
function matchExportOrProps(exports: any, matcher: SimpleMatcher): any {
  try {
    if (matcher(exports)) return exports;
  } catch {}
  if (exports && typeof exports === 'object') {
    for (const key in exports) {
      if (!Object.hasOwn(exports, key)) continue;
      try {
        if (matcher(exports[key])) return exports[key];
      } catch {}
    }
  }
  return undefined;
}

const pendingMatchers = new Map<symbol, { matcher: SimpleMatcher; resolve: (exp: any) => void }>();

export function waitForExport<T>(matcher: ExportMatcher<T>): Promise<T>;
export function waitForExport<T>(matcher: SimpleMatcher): Promise<T>;
export function waitForExport(matcher: SimpleMatcher): Promise<any> {
  const existing = getExport(matcher);
  if (existing !== undefined) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const id = Symbol();
    pendingMatchers.set(id, {
      matcher,
      resolve: (exp) => {
        pendingMatchers.delete(id);
        resolve(exp);
      },
    });
  });
}

function checkPendingMatchers(exports: any) {
  for (const [, pending] of pendingMatchers) {
    const found = matchExportOrProps(exports, pending.matcher);
    if (found !== undefined) pending.resolve(found);
  }
}

const moduleLoadCallbacks: ((exports: any) => void)[] = [];

export function onModuleLoaded(cb: (exports: any) => void): void {
  moduleLoadCallbacks.push(cb);
}

/** Fire `cb` for every match, loaded and future: Slack may load several copies of React. */
export function forEachExport(matcher: SimpleMatcher, cb: (exp: any) => void): void {
  const seen = new WeakSet<object>();
  const fire = (found: any) => {
    if (!isIndexable(found)) return;
    if (seen.has(found)) return;
    seen.add(found);
    cb(found);
  };

  for (const exports of moduleRegistry.values()) {
    const found = matchExportOrProps(exports, matcher);
    if (found !== undefined) fire(found);
  }
  onModuleLoaded((exports) => {
    const found = matchExportOrProps(exports, matcher);
    if (found !== undefined) fire(found);
  });
}

type ModuleExportsPatcher = (exports: any, moduleId: string) => any | undefined;
const moduleExportsPatchers = new Set<ModuleExportsPatcher>();

/** Inspect or replace a module's exports the moment it finishes initializing. */
export function patchModuleExports(patcher: ModuleExportsPatcher): () => void {
  moduleExportsPatchers.add(patcher);
  return () => moduleExportsPatchers.delete(patcher);
}

export function patchExportFunction(
  name: string,
  wrap: (original: (...args: any[]) => any) => (...args: any[]) => any,
): () => void {
  return patchModuleExports((exports) => {
    if (!exports || typeof exports !== 'object') return;
    for (const key of Object.keys(exports)) {
      let value: any;
      try {
        value = exports[key];
      } catch {
        continue;
      }
      if (typeof value !== 'function' || value.name !== name) continue;

      // Webpack defines namespace exports as non-configurable getters, so the
      // property cannot be reassigned; the exports object has to be rebuilt.
      const descriptors = Object.getOwnPropertyDescriptors(exports);
      descriptors[key] = { value: wrap(value), enumerable: true, configurable: true, writable: true };
      return Object.create(Object.getPrototypeOf(exports), descriptors);
    }
  });
}

function wrapModuleFactory(moduleId: PropertyKey, factory: ModuleFactory): ModuleFactory {
  if ((factory as any).__slickWrapped) return factory;

  moduleFactories.set(String(moduleId), factory);

  const wrapped = function slickModuleFactory(module: WebpackModule, exports: Exports, require: WebpackRequire): any {
    const result = factory.call(exports, module, exports, require);

    let moduleExports = module.exports;
    for (const patcher of moduleExportsPatchers) {
      try {
        const replaced = patcher(moduleExports, String(moduleId));
        if (replaced !== undefined && replaced !== moduleExports) {
          module.exports = replaced;
          moduleExports = replaced;
        }
      } catch (error) {
        console.error('[slick] module exports patcher threw:', error);
      }
    }

    moduleRegistry.set(moduleId, moduleExports);
    registerExportOwner(String(moduleId), moduleExports);
    checkPendingMatchers(moduleExports);
    for (const cb of moduleLoadCallbacks) {
      try {
        cb(moduleExports);
      } catch (error) {
        console.error('[slick] module load callback threw:', error);
      }
    }

    return result;
  };

  (wrapped as any).__slickWrapped = true;
  return wrapped;
}

type PushFn = (...items: Chunk[]) => number;

function wrapPush(originalPush: PushFn): PushFn {
  return function slickPush(this: any, ...chunks: Chunk[]): number {
    for (const chunk of chunks) {
      if (!Array.isArray(chunk) || chunk.length < 2) continue;

      const [, modules, runtime] = chunk;

      if (modules && typeof modules === 'object') {
        for (const moduleId of Object.keys(modules)) {
          const factory = modules[moduleId];
          if (typeof factory === 'function') modules[moduleId] = wrapModuleFactory(moduleId, factory);
        }
      }

      // The chunk's runtime callback receives __webpack_require__.
      if (typeof runtime === 'function' && !webpackRequire) {
        const originalRuntime = runtime;
        chunk[2] = function slickRuntime(require: WebpackRequire) {
          if (!webpackRequire) {
            webpackRequire = require;
            global.__slickWebpackRequire = require;
          }
          return originalRuntime(require);
        };
      }
    }

    return originalPush.apply(this, chunks);
  };
}

// Slack has migrated from webpack to rspack; both globals are hooked because
// which one is live depends on the build being served.
const CHUNK_GLOBALS = ['webpackChunkwebapp', 'rspackChunkwebapp'];

function installHook(globalName: string) {
  let backing: Chunk[] | null = null;

  Object.defineProperty(global, globalName, {
    configurable: true,
    enumerable: true,
    get() {
      return backing;
    },
    set(array: Chunk[]) {
      backing = array;
      let wrappedPush = wrapPush(array.push.bind(array));

      // Webpack reassigns `push` when the runtime installs; keep wrapping
      // whatever it replaces ours with.
      try {
        Object.defineProperty(array, 'push', {
          configurable: true,
          enumerable: false,
          get() {
            return wrappedPush;
          },
          set(nextPush: PushFn) {
            wrappedPush = wrapPush(nextPush);
          },
        });
      } catch (error) {
        console.error(`[slick] could not intercept ${globalName}.push; this chunk array will run unmodified:`, error);
      }
    },
  });
}

export function installWebpackHooks() {
  const descriptors = new Map(CHUNK_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]));
  for (const [name, descriptor] of descriptors) {
    if (descriptor && !descriptor.configurable) throw new Error(`[slick] ${name} cannot be intercepted`);
  }

  const installed: string[] = [];
  try {
    for (const name of CHUNK_GLOBALS) {
      installHook(name);
      installed.push(name);
    }
  } catch (error) {
    for (const name of installed) {
      const descriptor = descriptors.get(name);
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
    throw error;
  }
}

export function getExport<T>(matcher: ExportMatcher<T>): T | undefined;
export function getExport<T>(matcher: SimpleMatcher): T | undefined;
export function getExport<T>(matcher: SimpleMatcher, all: true): T[];
export function getExport(matcher: SimpleMatcher, all = false) {
  const results = new Set<any>();

  for (const exports of moduleRegistry.values()) {
    const candidates = [exports];
    for (const key in exports) {
      if (!Object.hasOwn(exports, key)) continue;
      try {
        candidates.push(exports[key]);
      } catch {}
    }
    for (const candidate of candidates) {
      try {
        if (!matcher(candidate)) continue;
      } catch {
        continue;
      }
      if (!all) return candidate;
      results.add(candidate);
    }
  }
  return all ? [...results] : undefined;
}

export function getByProps<T>(props: string[]): T | undefined;
export function getByProps<T>(props: string[], all: true): T[];
export function getByProps(props: string[], all = false) {
  const matcher = (exp: any) => exp && typeof exp === 'object' && props.every((prop) => prop in exp);
  return all ? getExport(matcher, true) : getExport(matcher);
}

export function getModuleSource(id: PropertyKey): string {
  const factory = moduleFactories.get(String(id));
  if (!factory) throw new Error(`[slick] no module with id: ${String(id)}`);
  return factory.toString();
}

export function* moduleSources(): Generator<[id: string, source: string]> {
  for (const [id, factory] of moduleFactories) yield [id, factory.toString()];
}

export function findModuleId(value: any): string | undefined {
  if (!isIndexable(value)) return undefined;
  return exportOwners.get(value);
}

export function getValueSource(value: any): string {
  const id = findModuleId(value);
  if (id !== undefined) return getModuleSource(id);
  if (typeof value === 'function') return value.toString();
  throw new Error('[slick] no module or source for value', { cause: value });
}

export function allExports(): [string, any][] {
  return [...moduleRegistry.entries()].map(([id, exports]) => [String(id), exports]);
}

export const stats = () => ({ modules: moduleRegistry.size, hasRequire: !!webpackRequire });

// Discovery aids for DevTools.
export function exposeDebugGlobals() {
  const debug = {
    __slickModuleRegistry: moduleRegistry,
    __slickModuleFactories: moduleFactories,
    allExports,
    getExport,
    getByProps,
    getModuleSource,
    findModuleId,
    getValueSource,
  };
  for (const [name, value] of Object.entries(debug)) {
    try {
      global[name] = value;
    } catch (error) {
      console.error(`[slick] could not expose webpack debug global ${name}:`, error);
    }
  }
}
