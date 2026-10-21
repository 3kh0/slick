import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  stdin: {
    contents: `export { PluginManager } from './src/app/pluginManager.ts';
      export { ConfigStore } from './src/app/configStore.ts';
      export { SlickPlugin } from './src/shared/Plugin.ts';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'iife',
  globalName: 'Host',
  define: { __SLICK_LOADER__: '"electron"' },
  plugins: [
    {
      name: 'slack-discovery',
      setup(builder) {
        builder.onResolve({ filter: /\/(react\.tsx|redux\.ts|rtm\.ts|webpack\.ts)$/ }, (args) => ({
          path: args.path,
          namespace: 'fake-slack',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fake-slack' }, () => ({
          contents: `
      export const patchingReady = Promise.resolve();
      export const reactReady = Promise.resolve();
      export const reduxReady = Promise.resolve({});
      export const rtmReady = Promise.resolve({});
      export const getComponent = () => {};
      export const getComponentSource = () => {};
      export const getFiberFromNode = () => {};
      export const getRenderedComponent = () => {};
      export const patchComponent = () => { globalThis.registrations++; return () => globalThis.registrations--; };
      export const waitForComponent = () => {};
      export const waitForRenderedComponent = () => {};
      export const findModuleId = () => {};
      export const getByProps = () => {};
      export const getExport = () => {};
      export const getValueSource = () => {};
      export const moduleSources = () => {};
      export const waitForExport = () => new Promise(() => {});
      export const getStore = () => null;
      export const getRawState = () => ({});
      export const getExportOrWait = () => new Promise(() => {});
      export const forEachExport = () => {};
      export const getPatchVersion = () => 0;
      export const mapEntries = () => [];
      export const patchSlice = () => () => {};
      export const dispatchThunk = () => {};
      export const lazyComponent = () => () => {};
    `,
          loader: 'js',
        }));
      },
    },
  ],
});

async function fixture() {
  const events = new EventTarget();
  const context = createContext({
    console,
    AbortController,
    Event,
    EventTarget,
    structuredClone,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    window: events,
    location: { pathname: '/client/T1/C1' },
    registrations: 0,
  });
  runInContext(bundle.outputFiles[0]!.text, context);
  let saved = '{}';
  const blobs = new Map<string, Map<string, string>>();
  const blobStore = (namespace: string) => {
    const blob = blobs.get(namespace) ?? blobs.set(namespace, new Map()).get(namespace)!;
    return {
      readAll: async () => Object.fromEntries(blob),
      write: async (key: string, value: string) => !!blob.set(key, value),
      delete: async (key: string) => blob.delete(key),
      clear: async () => (blob.clear(), true),
    };
  };
  const bridge = {
    loader: 'electron',
    fetch: async () => {},
    readSettings: async () => saved,
    readUserCss: async () => '',
    writeSettings: async (text: string) => {
      saved = text;
      return true;
    },
    onSettingsChange: () => () => {},
    onUserCssChange: () => () => {},
    blobStore,
    plugin: () => ({ call: async () => {}, on: () => () => {} }),
  };
  const { ConfigStore, PluginManager, SlickPlugin } = context.Host;
  const config = new ConfigStore(bridge);
  await config.init();
  const manager = new PluginManager(bridge, config);
  const starts: any[] = [];
  const stops: any[] = [];
  let start: (() => Promise<void>) | undefined;
  class Probe extends SlickPlugin {
    static id = 'Probe';
    static pluginName = 'Probe';
    static requiredAPIs = [];
    static defaultEnabled = true;
    async start() {
      starts.push(this);
      this.api.patchComponent('Example', () => {});
      await start?.();
    }
    stop() {
      stops.push(this);
    }
  }
  manager.register(Probe);
  return {
    context,
    bridge,
    blobs,
    config,
    manager,
    starts,
    stops,
    setStart: (fn: () => Promise<void>) => {
      start = fn;
    },
    navigate: (id: string) => {
      context.location.pathname = `/client/${id}`;
      events.dispatchEvent(new Event('popstate'));
    },
  };
}

test('workspace changes dispose resources, restart once and preserve the global toggle', async () => {
  const f = await fixture();
  await f.config.setPluginWorkspaces('Probe', ['T1', 'T2']);
  await f.manager.reconcile();
  assert.equal(f.context.registrations, 1);
  assert.equal(f.starts.length, 1);
  const old = f.starts[0];
  f.navigate('T2');
  assert.equal(old.api.signal.aborted, true);
  assert.equal(old.api.isActive(), false);
  await f.manager.reconcile();
  assert.equal(f.starts.length, 2);
  assert.equal(f.stops.length, 1);
  assert.equal(f.context.registrations, 1);
  f.navigate('T3');
  await f.manager.reconcile();
  assert.equal(f.context.registrations, 0);
  assert.equal(f.manager.info()[0].enabled, true);
  assert.equal(f.manager.info()[0].workspaceAllowed, false);
  await f.config.setPluginWorkspaces('Probe', null);
  await f.manager.reconcile();
  assert.equal(f.context.registrations, 1);
  assert.equal(f.manager.info()[0].running, true);
  await f.config.setPluginEnabled('Probe', false);
  await f.manager.reconcile();
  assert.equal(f.context.registrations, 0);
});

test('disabling during async start aborts immediately and cannot resurrect a plugin', async () => {
  const f = await fixture();
  let release!: () => void;
  let didStart!: () => void;
  const started = new Promise<void>((resolve) => {
    didStart = resolve;
  });
  f.setStart(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
        didStart();
      }),
  );
  const starting = f.manager.reconcile();
  await started;
  const instance = f.starts[0];
  await f.config.setPluginWorkspaces('Probe', []);
  assert.equal(instance.api.signal.aborted, true);
  assert.equal(f.context.registrations, 0);
  release();
  await starting;
  await f.manager.reconcile();
  assert.equal(f.manager.info()[0].running, false);
  assert.equal(f.stops.length, 1);
});

test('replace swaps a running plugin for the new class and keeps a disabled one stopped', async () => {
  const f = await fixture();
  await f.manager.reconcile();
  const old = f.starts[0];
  const { SlickPlugin } = f.context.Host;
  const swapped: any[] = [];
  class Next extends SlickPlugin {
    static id = 'Probe';
    static pluginName = 'Probe v2';
    static requiredAPIs = [];
    static defaultEnabled = true;
    start() {
      swapped.push(this);
      this.api.patchComponent('Example', () => {});
    }
  }
  await f.manager.replace(Next);
  assert.equal(old.api.signal.aborted, true);
  assert.equal(f.stops.length, 1);
  assert.equal(swapped.length, 1);
  assert.equal(f.context.registrations, 1);
  assert.equal(f.manager.info()[0].name, 'Probe v2');
  assert.equal(f.manager.info()[0].running, true);

  await f.config.setPluginEnabled('Probe', false);
  await f.manager.reconcile();
  await f.manager.replace(Next);
  assert.equal(swapped.length, 1);
  assert.equal(f.context.registrations, 0);
});

const userPlugin = (id: string, version: number) => `
(globalThis.__slickPlugins ??= []).push((require) => {
  const { SlickPlugin } = require('$slick');
  return class extends SlickPlugin {
    static id = '${id}';
    static pluginName = '${id} v${version}';
    static requiredAPIs = [];
    static defaultEnabled = true;
    start() { globalThis.userVersion = ${version}; this.api.patchComponent('Example', () => {}); }
  };
});`;

test('user plugins install, update in place, reload from storage and remove cleanly', async () => {
  const f = await fixture();
  await f.manager.reconcile();
  assert.equal(await f.manager.installUserPlugin(userPlugin('Mine', 1)), 'Mine v1');
  assert.equal(f.context.userVersion, 1);
  assert.equal(await f.manager.installUserPlugin(userPlugin('Mine', 2)), 'Mine v2');
  assert.equal(f.context.userVersion, 2);
  assert.equal(f.context.registrations, 2);
  await assert.rejects(f.manager.installUserPlugin(userPlugin('Probe', 1)), /built into Slick/);

  const reloaded = new f.context.Host.PluginManager(f.bridge, f.config);
  await reloaded.loadUserPlugins();
  assert.deepEqual(
    Array.from(reloaded.info(), (info: any) => [info.id, info.name, info.user]),
    [['Mine', 'Mine v2', true]],
  );

  await f.manager.removeUserPlugin('Mine');
  assert.equal(f.context.registrations, 1);
  assert.deepEqual(
    Array.from(f.manager.info(), (info: any) => info.id),
    ['Probe'],
  );
  assert.equal(f.blobs.get('user-plugins')?.size, 0);
});

test('plugins that web user scripts queue before or after boot are registered and started', async () => {
  const f = await fixture();
  runInContext(userPlugin('Early', 1), f.context);
  f.manager.adoptUserPlugins();
  await f.manager.reconcile();
  assert.equal(f.context.userVersion, 1);
  runInContext(userPlugin('Late', 2), f.context);
  await f.manager.reconcile();
  assert.equal(f.context.userVersion, 2);
  assert.deepEqual(
    Array.from(f.manager.info(), (info: any) => [info.id, info.user, info.running]),
    [
      ['Probe', false, true],
      ['Early', true, true],
      ['Late', true, true],
    ],
  );
});
