// Firefox-only, fully embedded MVP. The XPI is unsigned; release signing is separate.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import { zipSync } from 'fflate';
import { EXTENSION_PLUGINS } from '../../src/extension/plugins.ts';
import { PLUGINS, ROOT } from '../lib/paths.ts';
import { versions } from '../lib/versions.ts';
import { buildApp, bundleThemes } from './app.ts';

async function optionsData(): Promise<Plugin> {
  const color = (value: unknown) => (typeof value === 'string' ? value : null);
  const themes = Object.entries(await bundleThemes()).map(([id, theme]) => ({
    id,
    name: theme.name || id,
    background: color(theme.vars?.['--dt_color-base-pry']),
    accent: color(theme.sidebar?.badge),
  }));
  const contents = [
    ...EXTENSION_PLUGINS.map((id, i) => `import * as m${i} from ${JSON.stringify(path.join(PLUGINS, id, 'meta.ts'))};`),
    'export const plugins = [',
    ...EXTENSION_PLUGINS.map(
      (id, i) => `  { id: ${JSON.stringify(id)}, name: m${i}.pluginName, description: m${i}.description },`,
    ),
    '];',
    `export const themes = ${JSON.stringify(themes)};`,
    `export const version = ${JSON.stringify(versions.version)};`,
  ].join('\n');
  return {
    name: 'slick-options-data',
    setup(builder) {
      builder.onResolve({ filter: /^slick:options-data$/ }, () => ({
        path: 'options-data',
        namespace: 'slick-options',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'slick-options' }, () => ({
        contents,
        resolveDir: ROOT,
        loader: 'ts',
      }));
    },
  };
}

export async function buildExtension({ debug = false } = {}) {
  const source = path.join(ROOT, 'src/extension');
  const out = path.join(ROOT, 'dist/extension/firefox');
  await mkdir(out, { recursive: true });
  await buildApp({
    debug,
    targetLoader: 'extension',
    entryPoint: 'src/extension/page.ts',
    outFile: path.join(out, 'page.js'),
  });
  const manifest = JSON.parse(await readFile(path.join(source, 'firefox/manifest.json'), 'utf8'));
  // Keep the manifest numeric even for local builds whose app version has a git suffix.
  manifest.version = `2.0.${versions.build}`;
  const entries: Record<string, Uint8Array> = {
    'manifest.json': Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    'page.js': await readFile(path.join(out, 'page.js')),
  };
  const dataPlugin = await optionsData();
  for (const [name, entry] of [
    ['background', 'background.ts'],
    ['content', 'content.ts'],
    ['options', 'options-entry.ts'],
  ] as const) {
    const result = await build({
      entryPoints: [path.join(source, entry)],
      plugins: [dataPlugin],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      target: 'firefox140',
      minify: !debug,
      sourcemap: debug ? 'inline' : false,
    });
    entries[`${name}.js`] = result.outputFiles[0].contents;
  }
  for (const name of ['options.html', 'options.css']) entries[name] = await readFile(path.join(source, name));
  const lato = path.join(ROOT, 'node_modules/@fontsource/lato');
  for (const weight of [400, 700, 900]) {
    entries[`fonts/lato-${weight}.woff2`] = await readFile(path.join(lato, `files/lato-latin-${weight}-normal.woff2`));
  }
  entries['fonts/LICENSE-Lato.txt'] = await readFile(path.join(lato, 'LICENSE'));
  // Toolbar marks: the app's one-colour SVG, recoloured for light and dark toolbars.
  const mark = await readFile(path.join(ROOT, 'assets/desktop.svg'), 'utf8');
  entries['icons/black.svg'] = Buffer.from(mark);
  entries['icons/white.svg'] = Buffer.from(mark.replaceAll('fill="#000"', 'fill="#fff"'));
  for (const size of [16, 32, 128]) {
    entries[`icons/${size}.png`] = await readFile(path.join(ROOT, `assets/desktop-linux/${size}.png`));
  }
  for (const [name, bytes] of Object.entries(entries)) {
    await mkdir(path.dirname(path.join(out, name)), { recursive: true });
    await writeFile(path.join(out, name), bytes);
  }
  // Fixed timestamps keep identical inputs byte-reproducible.
  const archive = Object.fromEntries(
    Object.entries(entries).map(([name, bytes]) => [name, [bytes, { mtime: new Date('2000-01-01T00:00:00Z') }]]),
  ) as Parameters<typeof zipSync>[0];
  await writeFile(path.join(out, '../slick-firefox.xpi'), zipSync(archive));
  console.log('[build:firefox] dist/extension/firefox + slick-firefox.xpi (unsigned)');
}
