// Firefox-only, fully embedded MVP. The XPI is unsigned; release signing is separate.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { zipSync } from 'fflate';
import { ROOT } from '../lib/paths.ts';
import { versions } from '../lib/versions.ts';
import { buildApp } from './app.ts';

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
  for (const name of ['background', 'content', 'options']) {
    const result = await build({
      entryPoints: [path.join(source, `${name}.ts`)],
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
