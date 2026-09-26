import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../build/app.ts';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';
import { ROOT, SHARED } from './paths.ts';
import {
  discoverPlugins,
  EXTENSION_PLUGIN_NAMES,
  rendererRegistryModule,
  rendererRegistryPlugin,
  slickSharedAlias,
  type RendererRegistryOptions,
} from './plugin.ts';

async function registry(options: RendererRegistryOptions = {}) {
  const result = await build({
    stdin: {
      contents: `import plugins from 'slick:plugins';
        import { SlickPlugin } from ${JSON.stringify(path.join(SHARED, 'Plugin.ts'))};
        globalThis.result = { plugins, SlickPlugin };`,
      resolveDir: ROOT,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    plugins: [rendererRegistryPlugin(options), slickSharedAlias],
    loader: { '.gif': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' },
    define: { process: 'undefined' },
    metafile: true,
  });
  // Simulate CSP without unsafe-eval; static class initialization must still work.
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(result.outputFiles[0].text, context);
  const { plugins, SlickPlugin } = context.result;
  for (const [name, PluginClass] of Object.entries(plugins) as [string, any][]) {
    assert.equal(PluginClass.id, name);
    assert.ok(PluginClass.prototype instanceof SlickPlugin, `${name} must share the host base class`);
  }
  return { names: Object.keys(plugins).toSorted(), inputs: Object.keys(result.metafile.inputs) };
}

test('desktop statically bundles every renderer with shared class identity and no eval', async () => {
  const { names } = await registry();
  assert.deepEqual(
    names,
    discoverPlugins()
      .map((entry) => entry.name)
      .toSorted(),
  );
});

test('extension defaults to the explicit small renderer allowlist', async () => {
  const { names, inputs } = await registry({ targetLoader: 'extension' });
  assert.deepEqual(names, [...EXTENSION_PLUGIN_NAMES].toSorted());
  const pluginInputs = inputs.filter((input) => input.startsWith('src/plugins/'));
  assert.ok(pluginInputs.length > 0);
  for (const input of pluginInputs) {
    assert.ok(
      EXTENSION_PLUGIN_NAMES.some((name) => input.startsWith(`src/plugins/${name}/`)),
      input,
    );
    assert.ok(!input.endsWith('/main.ts'), input);
  }
});

test('explicit selection overrides defaults, deduplicates, and supports an empty registry', async () => {
  assert.deepEqual((await registry({ pluginNames: ['HumanCount', 'HumanCount'] })).names, ['HumanCount']);
  assert.deepEqual((await registry({ targetLoader: 'extension', pluginNames: [] })).names, []);
});

test('custom extension entry installs its bridge before main claims it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'slick-registry-'));
  try {
    await writeFile(path.join(dir, 'bridge-setup.ts'), 'globalThis.SlickBridge = { claim: () => null };');
    const entryPoint = path.join(dir, 'page.ts');
    await writeFile(
      entryPoint,
      `import './bridge-setup'; import ${JSON.stringify(path.join(ROOT, 'src/app/main.ts'))};`,
    );
    const outFile = path.join(dir, 'nested/page.js');
    assert.equal(await buildApp({ debug: true, targetLoader: 'extension', entryPoint, outFile }), outFile);
    const code = await readFile(outFile, 'utf8');
    const setup = code.indexOf('globalThis.SlickBridge =');
    const claim = code.indexOf('globalThis.SlickBridge?.claim');
    assert.ok(setup >= 0 && claim > setup, 'bridge setup must precede the one-shot claim');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unknown plugin names fail rather than silently omitting a requested renderer', () => {
  assert.throws(() => rendererRegistryModule({ pluginNames: ['MissingPlugin'] }), /unknown renderer plugin/);
});
