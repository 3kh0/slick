// Slack's React and JSX runtime are wrapped so every element type passes
// through `resolveType` before React sees it; that is how plugins change
// Slack's UI without a MutationObserver. Each type resolves once per set of
// patches (identity-keyed weak caches; host tag strings in a plain Map).

import { forEachExport, findModuleId, getExport, getValueSource, waitForExport } from './webpack.ts';
import { Store } from '../store.ts';

const global = globalThis as any;

export type ComponentType<P = any> = React.ComponentType<P> | string;
export type ComponentReplacer<P = any> = (Original: ComponentType<P>) => ComponentType<P>;
type Filter = (exp: any) => boolean;

function isReact(exp: any): exp is typeof import('react') {
  return exp && typeof exp === 'object' && 'createElement' in exp && 'Component' in exp && 'useState' in exp;
}

function isJsxRuntime(exp: any): boolean {
  return !!(exp && typeof exp === 'object' && exp.jsx && exp.jsxs && exp.Fragment);
}

// Slack's displayName on connected/memo components is not a contract;
// anything load-bearing should prefer a filter.

const originalComponentSymbol = Symbol.for('slick.originalComponent');

type OriginalComponentObject = {
  $$typeof: typeof originalComponentSymbol;
  originalComponent: ComponentType;
  displayName: string;
};

function isOriginalComponentObject(value: any): value is OriginalComponentObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    value.$$typeof === originalComponentSymbol &&
    'originalComponent' in value
  );
}

export function getComponentName(component: any): string | null {
  if (!component) return null;

  if (typeof component === 'object') {
    if (component.$$typeof === Symbol.for('react.memo')) return getComponentName(component.type);
    if (component.$$typeof === Symbol.for('react.forward_ref')) {
      return component.displayName || component.render?.displayName || component.render?.name || null;
    }
    if (component.$$typeof === originalComponentSymbol) return component.displayName || null;
  }
  if (typeof component === 'function') return component.displayName || component.name || null;

  return null;
}

function getDisplayName(component: ComponentType): string {
  if (typeof component === 'string') return component;
  return getComponentName(component) || 'Component';
}

function componentFilter(name: string, filter?: Filter): Filter {
  return (exp: any) => {
    if (!exp) return false;
    if (filter && !filter(exp)) return false;
    if (getComponentName(exp) === name) return true;
    return exp.$$typeof === Symbol.for('react.memo') && exp.displayName === name;
  };
}

/** Throws if the component's chunk has not loaded yet. */
export function getComponent<P extends {}>(name: string, all?: false, filter?: Filter): React.ComponentType<P>;
export function getComponent<P extends {}>(name: string, all: true, filter?: Filter): React.ComponentType<P>[];
export function getComponent(name: string, all = false, filter?: Filter) {
  const match = componentFilter(name, filter);
  if (all) return getExport(match, true);

  const found = getExport(match);
  if (!found) throw new Error(`[slick] could not find component: ${name}`);
  return found;
}

/** Resolves whenever the component turns up. Use outside of a render. */
export function waitForComponent<P extends {}>(name: string, filter?: Filter): Promise<React.ComponentType<P>> {
  return waitForExport<React.ComponentType<P>>(componentFilter(name, filter));
}

const MISSING_MS = 30_000;

/**
 * Renders the real component once its chunk arrives, nothing until then.
 * Backs the elements registry, so plugins can use `api.elements.Button` before
 * Slack loads that chunk. Lookup is deferred to first render so unused entries
 * cost nothing.
 */
export function lazyComponent<P extends {}>(name: string, filter?: Filter): React.ComponentType<P> {
  const match = componentFilter(name, filter);
  const component = new Store<React.ComponentType<P> | undefined>(undefined);
  let looked = false;

  const look = () => {
    if (looked) return;
    looked = true;

    const loaded = getExport<React.ComponentType<P>>(match);
    if (loaded) {
      component.set(loaded);
      return;
    }
    void waitForExport<React.ComponentType<P>>(match).then(component.set);
    setTimeout(() => {
      if (component.get()) return;
      console.error(`[slick] "${name}" is unavailable`);
      const MissingComponent = () => (
        <span title={`Slick could not find Slack's ${name} component`}>{name} unavailable</span>
      );
      MissingComponent.displayName = `Missing(${name})`;
      component.set(MissingComponent as React.ComponentType<P>);
    }, MISSING_MS);
  };

  function LazyComponent(props: P) {
    // Looking synchronously here keeps an already-loaded component from
    // flashing in a tick later.
    look();
    const Component = component.use();
    return Component ? <Component {...props} /> : null;
  }
  LazyComponent.displayName = `Lazy(${name})`;
  return LazyComponent;
}

// Many components are never exported and `connect` keeps no link to the
// wrapped one, so record what resolveType actually sees.
const renderedComponents = new Map<string, ComponentType>();
const renderedWaiters = new Map<string, Set<(component: ComponentType) => void>>();

function rememberRendered(type: any) {
  const name = getComponentName(type);
  if (!name || renderedComponents.has(name)) return;
  renderedComponents.set(name, type);

  const waiters = renderedWaiters.get(name);
  if (!waiters) return;
  renderedWaiters.delete(name);
  for (const resolve of waiters) resolve(type);
}

/** Knows only what has actually rendered. Prefer getComponent where possible. */
export function getRenderedComponent(name: string): ComponentType | undefined {
  return renderedComponents.get(name);
}

export function waitForRenderedComponent(name: string): Promise<ComponentType> {
  const seen = renderedComponents.get(name);
  if (seen) return Promise.resolve(seen);

  return new Promise((resolve) => {
    let waiters = renderedWaiters.get(name);
    if (!waiters) {
      waiters = new Set();
      renderedWaiters.set(name, waiters);
    }
    waiters.add(resolve);
  });
}

function unwrapComponentLayers(component: any): any[] {
  const layers: any[] = [];
  let current = component;
  while (current && layers.length < 10) {
    layers.push(current);
    if (isOriginalComponentObject(current)) current = current.originalComponent;
    else if (typeof current === 'object' && current.$$typeof === Symbol.for('react.memo')) current = current.type;
    else if (typeof current === 'object' && current.$$typeof === Symbol.for('react.forward_ref'))
      current = current.render;
    else break;
  }
  return layers;
}

export function getComponentSource(component: ComponentType): string {
  if (typeof component === 'string') throw new Error(`[slick] "${component}" is a host element, not a component`);
  for (const layer of unwrapComponentLayers(component)) {
    if (findModuleId(layer) !== undefined) return getValueSource(layer);
  }
  const innermost = unwrapComponentLayers(component).pop();
  if (typeof innermost === 'function') return innermost.toString();
  throw new Error('[slick] could not find source for component', { cause: component });
}

export function getFiberFromNode(node: Element): any | null {
  const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  return key ? (node as any)[key] : null;
}

function getRootFiber(): any | null {
  const container = document.querySelector('.p-client_container');
  if (!container) return null;
  const key = Object.keys(container).find((k) => k.startsWith('__reactContainer$'));
  return key ? (container as any)[key] : null;
}

/**
 * Poisoning memoized props makes a mounted subtree re-run when React next
 * visits it (it does not schedule an update). Batched to one walk per
 * microtask; iterative because recursing down `sibling` can overflow the stack
 * on a long channel.
 */
let dirtyQueued = false;

function dirtyMemoizationCache() {
  if (dirtyQueued) return;
  dirtyQueued = true;
  queueMicrotask(() => {
    dirtyQueued = false;
    const root = getRootFiber();
    if (!root) return;

    const stack: any[] = [root];
    while (stack.length) {
      const node = stack.pop();
      if (node.memoizedProps && typeof node.memoizedProps === 'object') {
        node.memoizedProps = { ...node.memoizedProps, __slickPoison: 1 };
      }
      if (node.sibling) stack.push(node.sibling);
      if (node.child) stack.push(node.child);
    }
  });
}

type ComponentMatcher = (component: ComponentType) => boolean;
const replacements = new Map<ComponentMatcher, ComponentReplacer>();

let notPatched = new WeakSet<object>();
let resolved = new WeakMap<object, ComponentType>();
// Host elements are the bulk of renders; without this every one ran every matcher.
let resolvedHosts = new Map<string, any>();

function invalidateCaches() {
  notPatched = new WeakSet<object>();
  resolved = new WeakMap<object, ComponentType>();
  resolvedHosts = new Map<string, any>();
}

const originalObjectCache = new Map<ComponentType, OriginalComponentObject>();

function getOriginalComponentObject(component: ComponentType): OriginalComponentObject {
  const cached = originalObjectCache.get(component);
  if (cached) return cached;

  const object: OriginalComponentObject = {
    $$typeof: originalComponentSymbol,
    originalComponent: component,
    displayName: getDisplayName(component),
  };
  originalObjectCache.set(component, object);
  return object;
}

const notHoisted = new Set([
  'length',
  'name',
  'prototype',
  'caller',
  'callee',
  'arguments',
  'displayName',
  'defaultProps',
  'propTypes',
  'contextType',
  'contextTypes',
  'childContextTypes',
  'getDerivedStateFromProps',
  'getDerivedStateFromError',
  '$$typeof',
  'type',
  'render',
  'compare',
]);

/** Slack reads statics off its components, so a replacement has to carry them. */
function hoistStatics(replaced: any, original: any): void {
  const holds = (value: any) => value && (typeof value === 'function' || typeof value === 'object');
  if (!holds(replaced) || !holds(original)) return;

  for (const key of Object.getOwnPropertyNames(original)) {
    if (notHoisted.has(key) || Object.hasOwn(replaced, key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(original, key);
    if (!descriptor) continue;
    try {
      Object.defineProperty(replaced, key, descriptor);
    } catch {}
  }
}

const replacerResults = new WeakMap<ComponentReplacer, Map<ComponentType, ComponentType>>();

function applyReplacer<P = any>(replacer: ComponentReplacer<P>, original: ComponentType<P>): ComponentType<P> {
  let cache = replacerResults.get(replacer);
  if (!cache) {
    cache = new Map();
    replacerResults.set(replacer, cache);
  }
  const hit = cache.get(original);
  if (hit) return hit as ComponentType<P>;

  const replaced = replacer(original);
  if (typeof replaced === 'function' && !('displayName' in replaced)) {
    replaced.displayName = `Patched(${getDisplayName(original)})`;
  }
  cache.set(original, replaced);
  return replaced;
}

function resolveType(type: any, props: any): any {
  if (typeof type === 'string' && !props?.__original) {
    const host = resolvedHosts.get(type);
    if (host !== undefined) return host;
    const result = resolveUncached(type, props);
    resolvedHosts.set(type, result);
    return result;
  }
  return resolveUncached(type, props);
}

function resolveUncached(type: any, props: any): any {
  // `__original` lets a replacement render the component it wrapped without
  // recursing back into itself.
  if (props?.__original) {
    delete props.__original;
    return type;
  }
  if (isOriginalComponentObject(type)) return type.originalComponent;

  const cacheable = typeof type === 'object' || typeof type === 'function';
  if (cacheable) {
    if (notPatched.has(type)) return type;
    const hit = resolved.get(type);
    if (hit) return hit;
    rememberRendered(type);
  }

  const matched: [ComponentMatcher, ComponentReplacer][] = [];
  for (const [matches, replacer] of replacements) {
    try {
      if (matches(type)) matched.push([matches, replacer]);
    } catch {}
  }

  if (!matched.length) {
    if (cacheable) notPatched.add(type);
    return type;
  }

  // Start from the marker object so several plugins can stack on one component.
  const original = getOriginalComponentObject(type) as unknown as ComponentType;
  let replaced = original;
  for (const [matches, replacer] of matched) {
    try {
      replaced = applyReplacer(replacer, replaced);
    } catch (error) {
      replacements.delete(matches);
      invalidateCaches();
      console.error(`[slick] component patch for "${getDisplayName(type)}" threw and was disabled:`, replacer, error);
    }
  }
  if (replaced === original) {
    if (cacheable) notPatched.add(type);
    return type;
  }
  hoistStatics(replaced, type);
  if (cacheable) resolved.set(type, replaced);
  return replaced;
}

export type PatchMatcher<P = any> = string | { displayName?: string; filter?: Filter; component?: ComponentType<P> };

/** Replace a component wherever Slack renders it. Returns a disposer. */
export function patchComponent<P = object>(matcher: PatchMatcher<P>, replacement: ComponentReplacer<P>): () => void {
  const displayName = typeof matcher === 'string' ? matcher : matcher.displayName;
  const filter = typeof matcher === 'string' ? undefined : matcher.filter;
  const component = typeof matcher === 'string' ? undefined : matcher.component;

  const matches: ComponentMatcher = (candidate: any) => {
    if (component && candidate === component) return true;
    if (displayName === undefined && !filter) return false;
    if (displayName !== undefined && getComponentName(candidate) !== displayName) return false;
    if (filter && !filter(candidate)) return false;
    return true;
  };

  replacements.set(matches, replacement as ComponentReplacer);
  invalidateCaches();
  dirtyMemoizationCache();

  return () => {
    replacements.delete(matches);
    invalidateCaches();
    dirtyMemoizationCache();
  };
}

// forEachExport, not a single wait: Slack can load more than one copy of
// React / the JSX runtime and each needs wrapping.

export const reactReady: Promise<typeof import('react')> = new Promise((resolve) => {
  forEachExport(isReact, (React) => {
    const original = React.createElement;
    React.createElement = (type: any, props: any, ...children: any[]) =>
      original(resolveType(type, props), props, ...children);
    // Plugins compile JSX against Slack's own React; they never bundle one.
    global.React = React;
    resolve(React);
  });
});

export const jsxRuntimeReady: Promise<void> = new Promise((resolve) => {
  forEachExport(isJsxRuntime, (runtime) => {
    const originalJsx = runtime.jsx;
    const originalJsxs = runtime.jsxs;
    runtime.jsx = (type: any, props: any, key: any) => originalJsx(resolveType(type, props), props, key);
    runtime.jsxs = (type: any, props: any, key: any) => originalJsxs(resolveType(type, props), props, key);
    resolve();
  });
});

/** Resolves once both runtimes are wrapped and patchComponent is safe to use. */
export const patchingReady = (async () => {
  await reactReady;
  await jsxRuntimeReady;
})();

export function exposeDebugGlobals() {
  const debug = {
    getComponent,
    waitForComponent,
    getRenderedComponent,
    waitForRenderedComponent,
    getComponentSource,
    getFiberFromNode,
    patchComponent,
    __slickRenderedComponents: renderedComponents,
  };
  for (const [name, value] of Object.entries(debug)) {
    try {
      global[name] = value;
    } catch (error) {
      console.error(`[slick] could not expose React debug global ${name}:`, error);
    }
  }
}
