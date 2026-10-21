// Single-file user plugins: a plugin's own files bundled as CommonJS, with
// `$slick` left for the page to provide (src/app/userPlugins.ts).

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import { DIST, SHARED } from '../lib/paths.ts';
import { onImportOutside } from '../lib/plugin.ts';
import { pageBuildOptions, pagePlugins, writePage } from './app.ts';

const SLICK = path.join(SHARED, 'Plugin.ts');

const ownFilesOnly = (dir: string): Plugin => ({
  name: 'slick-user-plugin',
  setup(builder) {
    onImportOutside(builder, dir, (file) =>
      file === SLICK
        ? { path: '$slick', external: true }
        : {
            errors: [{ text: `${path.relative(dir, file)} is Slick's own code; user plugins can only import $slick` }],
          },
    );
  },
});

/** Builds a plugin directory (or entry file) into dist/plugins/<Name>.js, or `out`. */
export async function buildUserPlugin(input: string, out?: string) {
  const entry = statSync(input).isDirectory()
    ? ['index.tsx', 'index.ts'].map((file) => path.join(input, file)).find((file) => existsSync(file))
    : input;
  if (!entry) throw new Error(`${input} has no index.ts(x)`);
  const dir = path.resolve(path.dirname(entry));
  const name = /^index\.tsx?$/.test(path.basename(entry)) ? path.basename(dir) : path.parse(entry).name;
  if (existsSync(path.join(dir, 'main.ts'))) {
    throw new Error(`${name} has a main.ts; privileged halves only ship bundled into Slick`);
  }

  const { outputFiles } = await build({
    ...(await pageBuildOptions({})),
    absWorkingDir: dir,
    entryPoints: [path.resolve(entry)],
    format: 'cjs',
    minify: false,
    plugins: [ownFilesOnly(dir), ...pagePlugins],
  });
  const file = path.resolve(out ?? path.join(DIST, 'plugins', `${name}.js`));
  await writePage(file, outputFiles[0].text, 'plugin', `plugins/${name}.js`);
  return file;
}
