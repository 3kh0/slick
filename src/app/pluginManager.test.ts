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
    URL,
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
      read: async (key: string) => blob.get(key) ?? null,
      readAll: async () => Object.fromEntries(blob),
      write: async (key: string, value: string) => !!blob.set(key, value),
      delete: async (key: string) => (blob.delete(key), true),
      clear: async () => (blob.clear(), true),
    };
  };
  const remote = new Map<string, { status: number; body: string }>();
  const bridge = {
    loader: 'electron',
    fetch: async (url: string) => remote.get(url) ?? { status: 404, body: '' },
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
    remote,
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

test('plugins installed from a URL update themselves when the file changes', async () => {
  const f = await fixture();
  await f.manager.reconcile();
  const url = 'https://example.com/Mine.js';
  f.remote.set(url, { status: 200, body: userPlugin('Mine', 1) });
  assert.equal(await f.manager.installUserPluginFromUrl(url), 'Mine v1');
  assert.equal(f.manager.info().find((i: any) => i.id === 'Mine').source, url);

  const idle = await f.manager.updateUserPlugins();
  assert.equal(idle.updated.length, 0);
  assert.equal(idle.failed, 0);

  f.remote.set(url, { status: 200, body: userPlugin('Mine', 2) });
  assert.deepEqual(Array.from((await f.manager.updateUserPlugins()).updated), ['Mine v2']);
  assert.equal(f.context.userVersion, 2);

  f.remote.set(url, { status: 500, body: '' });
  assert.equal((await f.manager.updateUserPlugins()).failed, 1);
  f.remote.set(url, { status: 200, body: userPlugin('Other', 3) });
  assert.equal((await f.manager.updateUserPlugins()).failed, 1);
  assert.equal(f.context.userVersion, 2);

  const reloaded = new f.context.Host.PluginManager(f.bridge, f.config);
  await reloaded.loadUserPlugins();
  assert.equal(reloaded.info()[0].source, url);

  assert.equal(f.manager.autoUpdatesEnabled, true);
  await f.manager.setAutoUpdate(false);
  const off = new f.context.Host.PluginManager(f.bridge, f.config);
  await off.loadUserPlugins();
  assert.equal(off.autoUpdatesEnabled, false);
  await f.manager.setAutoUpdate(true);

  assert.equal(await f.manager.installUserPlugin(userPlugin('Mine', 4)), 'Mine v4');
  assert.equal(f.manager.info().find((i: any) => i.id === 'Mine').source, null);
  await f.manager.removeUserPlugin('Mine');
  assert.equal(f.blobs.get('user-plugin-sources')?.size, 0);
});

test('a plugin removed while its update downloads stays removed', async () => {
  const f = await fixture();
  await f.manager.reconcile();
  const url = 'https://example.com/Gone.js';
  f.remote.set(url, { status: 200, body: userPlugin('Gone', 1) });
  await f.manager.installUserPluginFromUrl(url);
  let started!: () => void;
  let release!: () => void;
  const fetching = new Promise<void>((resolve) => (started = resolve));
  f.bridge.fetch = async () => {
    started();
    await new Promise<void>((resolve) => (release = resolve));
    return { status: 200, body: userPlugin('Gone', 2) };
  };
  const pending = f.manager.updateUserPlugins();
  await fetching;
  await f.manager.removeUserPlugin('Gone');
  release();
  assert.equal((await pending).updated.length, 0);
  assert.equal(f.manager.plugins.has('Gone'), false);
  assert.equal(f.blobs.get('user-plugins')?.has('Gone'), false);
  assert.equal(f.blobs.get('user-plugin-sources')?.has('Gone'), false);
});

test('plugin URLs must be https and GitHub file pages map to raw files', async () => {
  const f = await fixture();
  await assert.rejects(f.manager.installUserPluginFromUrl('http://example.com/a.js'), /https/);
  await assert.rejects(f.manager.installUserPluginFromUrl('nope'), /valid URL/);
  f.remote.set('https://raw.githubusercontent.com/o/r/main/p/A.js', { status: 200, body: userPlugin('Gh', 1) });
  assert.equal(await f.manager.installUserPluginFromUrl('https://github.com/o/r/blob/main/p/A.js'), 'Gh v1');
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
