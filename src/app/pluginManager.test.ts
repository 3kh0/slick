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
    blobStore: () => ({}),
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
