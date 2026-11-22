// Builds slick.js — the in-page bundle that runs before Slack's first script.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { build, type BuildOptions, type Plugin } from 'esbuild';
import type { ThemeJson } from '../../src/app/theme.ts';
import { compactDictionary } from '../../src/plugins/HaikuWarning/haiku.ts';
import { bundledChangelog } from '../lib/changelog.ts';
import { APP, ROOT, SLICK_JS, THEMES } from '../lib/paths.ts';
import { hostModules, rendererRegistryPlugin, slickSharedAlias, type RendererRegistryOptions } from '../lib/plugin.ts';
import { versions } from '../lib/versions.ts';

const SOURCE_ORIGIN = 'slick:///';

export async function bundleThemes(): Promise<Record<string, ThemeJson>> {
  const themes: Record<string, ThemeJson> = {};
  const files = (await readdir(THEMES)).filter((file) => file.endsWith('.json')).toSorted();
  for (const file of files) {
    themes[path.basename(file, '.json')] = JSON.parse(await readFile(path.join(THEMES, file), 'utf8')) as ThemeJson;
  }
  console.log(`[build:themes] ${files.length} themes bundled`);
  return themes;
}

const haikuDictionary: Plugin = {
  name: 'haiku-dictionary',
  setup(builder) {
    builder.onLoad({ filter: /[\\/]HaikuWarning[\\/]syllable_counts\.txt$/ }, async (args) => ({
      contents: `gzip-base64:${gzipSync(compactDictionary(await readFile(args.path, 'utf8')), { level: 9 }).toString('base64')}`,
      loader: 'text',
    }));
  },
};

export type BuildAppOptions = RendererRegistryOptions & {
  debug?: boolean;
  hot?: boolean;
  extraPlugins?: Plugin[];
  themes?: Record<string, ThemeJson>;
  sourceUrl?: string;
  /** Paths are resolved relative to the repository root. */
  entryPoint?: string;
  outFile?: string;
};

export async function pageBuildOptions({
  debug = false,
  targetLoader = 'electron',
  themes,
}: Pick<BuildAppOptions, 'debug' | 'targetLoader' | 'themes'>) {
  const bundled = themes ?? (await bundleThemes());
  return {
    absWorkingDir: ROOT,
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: !debug,
    // Inline assets to preserve offline use without additional requests.
    loader: { '.gif': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl', '.txt': 'text' },
    sourcemap: debug ? 'inline' : false,
    define: {
      __SLICK_VERSION__: JSON.stringify(versions.version),
      __SLICK_BUILD__: JSON.stringify(versions.build),
      __SLICK_THEMES__: JSON.stringify(JSON.stringify(bundled)),
      __SLICK_CHANGELOG__: JSON.stringify(bundledChangelog(Number(process.env.SLICK_BUILD) || undefined)),
      __SLICK_LOADER__: JSON.stringify(targetLoader),
      // Page bundle: reaching for Node globals is a bug, so fail loudly.
      process: 'undefined',
      ...(targetLoader === 'userscript' ? { globalThis: 'unsafeWindow', window: 'unsafeWindow' } : {}),
    },
  } satisfies BuildOptions;
}

export const pagePlugins = [slickSharedAlias, haikuDictionary];

export async function writePage(file: string, code: string, label: string, url: string) {
  // Otherwise DevTools shows an anonymous script attributed to app.slack.com.
  code += `\n//# sourceURL=${SOURCE_ORIGIN}${url}\n`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, code);
  console.log(`[build:${label}] ${path.basename(file)}  ${(Buffer.byteLength(code) / 1024).toFixed(1)} KB`);
}

export async function buildEarly({
  debug = false,
  hot = false,
  targetLoader = 'electron',
  entryPoint = `${APP}/early.ts`,
  themes,
}: Pick<BuildAppOptions, 'debug' | 'hot' | 'targetLoader' | 'entryPoint' | 'themes'> = {}) {
  const { outputFiles, metafile } = await build({
    ...(await pageBuildOptions({ debug, targetLoader, themes })),
    entryPoints: [entryPoint],
    metafile: true,
    plugins: [...pagePlugins, ...(hot ? [hostModules] : [])],
  });
  const code = `${outputFiles[0].text}\n//# sourceURL=${SOURCE_ORIGIN}early.js\n`;
  console.log(`[build:early] early.js  ${(Buffer.byteLength(code) / 1024).toFixed(1)} KB`);
  return { code, metafile };
}

export const buildDesktopEarly = (o: Pick<BuildAppOptions, 'debug' | 'hot'> = {}) =>
  buildEarly({ ...o, targetLoader: 'electron', entryPoint: `${APP}/early.ts` });

const CORE_MODULES: Record<string, string> = {
  bridge: 'src/app/bridge.ts',
  accounts: 'src/app/api/accounts.ts',
  snappyBoot: 'src/plugins/Snappy/boot.ts',
  webpack: 'src/app/slack/webpack.ts',
  react: 'src/app/slack/react.tsx',
  redux: 'src/app/slack/redux.ts',
  rtm: 'src/app/slack/rtm.ts',
  resize: 'src/app/api/resize.ts',
  childWindows: 'src/app/slack/childWindows.ts',
  css: 'src/app/api/css.ts',
  store: 'src/app/store.ts',
};

const SHIM_SKIP = Symbol('slick-core-shim-skip');
const coreClaimPath = path.join(APP, 'coreClaim.ts');

export const sharedCoreShimPlugin: Plugin = {
  name: 'slick-shared-core-shim',
  setup(builder) {
    const byPath = new Map(Object.entries(CORE_MODULES).map(([id, file]) => [path.resolve(ROOT, file), id]));
    builder.onResolve({ filter: /.*/ }, async (a) => {
      if (a.pluginData === SHIM_SKIP || path.resolve(a.importer) === path.resolve(coreClaimPath)) return;
      const r = await builder.resolve(a.path, {
        kind: a.kind,
        importer: a.importer,
        resolveDir: a.resolveDir,
        pluginData: SHIM_SKIP,
      });
      const id = !r.errors.length && r.namespace === 'file' ? byPath.get(path.resolve(r.path)) : undefined;
      return id ? { path: id, namespace: 'slick-core-shim' } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: 'slick-core-shim' }, (a) => ({
      contents: `module.exports = require(${JSON.stringify(coreClaimPath)}).earlyCore?.[${JSON.stringify(a.path)}] ?? {};`,
      resolveDir: APP,
      loader: 'js',
    }));
  },
};

export const buildDesktopRuntime = (o: Pick<BuildAppOptions, 'debug' | 'hot'> = {}) =>
  buildApp({ ...o, targetLoader: 'electron', entryPoint: `${APP}/runtime.ts`, extraPlugins: [sharedCoreShimPlugin] });

export async function buildApp({
  debug = false,
  hot = false,
  extraPlugins = [],
  themes,
  sourceUrl = 'slick.js',
  entryPoint = `${APP}/main.ts`,
  outFile = SLICK_JS,
  targetLoader = 'electron',
  pluginNames,
}: BuildAppOptions = {}) {
  const output = path.resolve(ROOT, outFile);
  const { outputFiles, metafile } = await build({
    ...(await pageBuildOptions({ debug, targetLoader, themes })),
    entryPoints: [entryPoint],
    metafile: true,
    plugins: [
      rendererRegistryPlugin({ targetLoader, pluginNames }),
      ...pagePlugins,
      ...(hot ? [hostModules] : []),
      ...extraPlugins,
    ],
  });
  await writePage(output, outputFiles[0].text, 'app', sourceUrl);
  return { output, metafile };
}
