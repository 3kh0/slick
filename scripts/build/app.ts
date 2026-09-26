// Builds slick.js — the in-page bundle that runs before Slack's first script.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import type { ThemeJson } from '../../src/app/theme.ts';
import { APP, ROOT, SLICK_JS, THEMES } from '../lib/paths.ts';
import { rendererRegistryPlugin, slickSharedAlias, type RendererRegistryOptions } from '../lib/plugin.ts';
import { versions } from '../lib/versions.ts';

const SOURCE_ORIGIN = 'slick:///';

async function bundleThemes(): Promise<Record<string, ThemeJson>> {
  const themes: Record<string, ThemeJson> = {};
  const files = (await readdir(THEMES)).filter((file) => file.endsWith('.json')).toSorted();
  for (const file of files) {
    themes[path.basename(file, '.json')] = JSON.parse(await readFile(path.join(THEMES, file), 'utf8')) as ThemeJson;
  }
  console.log(`[build:themes] ${files.length} themes bundled`);
  return themes;
}

export type BuildAppOptions = RendererRegistryOptions & {
  debug?: boolean;
  /** Paths are resolved relative to the repository root. */
  entryPoint?: string;
  outFile?: string;
};

export async function buildApp({
  debug = false,
  entryPoint = `${APP}/main.ts`,
  outFile = SLICK_JS,
  targetLoader = 'electron',
  pluginNames,
}: BuildAppOptions = {}) {
  const themes = await bundleThemes();
  const output = path.resolve(ROOT, outFile);

  const result = await build({
    entryPoints: [entryPoint],
    absWorkingDir: ROOT,
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: !debug,
    plugins: [rendererRegistryPlugin({ targetLoader, pluginNames }), slickSharedAlias],
    // Inline assets to preserve offline use without additional requests.
    loader: { '.gif': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' },
    sourcemap: debug ? 'inline' : false,
    define: {
      __SLICK_VERSION__: JSON.stringify(versions.version),
      __SLICK_BUILD__: JSON.stringify(versions.build),
      __SLICK_THEMES__: JSON.stringify(themes),
      // Page bundle: reaching for Node globals is a bug, so fail loudly.
      process: 'undefined',
    },
  });

  let code = result.outputFiles[0].text;
  // Otherwise DevTools shows an anonymous script attributed to app.slack.com.
  code += `\n//# sourceURL=${SOURCE_ORIGIN}slick.js\n`;

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, code);
  console.log(`[build:app] ${path.basename(output)}  ${(Buffer.byteLength(code) / 1024).toFixed(1)} KB`);
  return output;
}
