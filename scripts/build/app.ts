// Builds slick.js — the in-page bundle that runs before Slack's first script.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { build, type BuildOptions, type Plugin } from 'esbuild';
import type { ThemeJson } from '../../src/app/theme.ts';
import { compactDictionary } from '../../src/plugins/HaikuWarning/haiku.ts';
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
  /** Paths are resolved relative to the repository root. */
  entryPoint?: string;
  outFile?: string;
};

export async function pageBuildOptions({
  debug = false,
  targetLoader = 'electron',
}: Pick<BuildAppOptions, 'debug' | 'targetLoader'>) {
  const themes = await bundleThemes();
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
      __SLICK_THEMES__: JSON.stringify(themes),
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

export async function buildApp({
  debug = false,
  hot = false,
  extraPlugins = [],
  entryPoint = `${APP}/main.ts`,
  outFile = SLICK_JS,
  targetLoader = 'electron',
  pluginNames,
}: BuildAppOptions = {}) {
  const output = path.resolve(ROOT, outFile);
  const { outputFiles, metafile } = await build({
    ...(await pageBuildOptions({ debug, targetLoader })),
    entryPoints: [entryPoint],
    metafile: true,
    plugins: [
      rendererRegistryPlugin({ targetLoader, pluginNames }),
      ...pagePlugins,
      ...(hot ? [hostModules] : []),
      ...extraPlugins,
    ],
  });
  await writePage(output, outputFiles[0].text, 'app', 'slick.js');
  return { output, metafile };
}
