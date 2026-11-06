// Dev hot reload: bundles one plugin on its own. Files in the plugin's directory
// are compiled in; anything else under src/ is the page's live copy, looked up
// in a hot slick.js (buildApp({ hot: true })) instead of duplicated.

import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import { onImportOutside, repoPath } from '../lib/plugin.ts';
import { DIST_DESKTOP, PLUGINS } from '../lib/paths.ts';
import { pageBuildOptions, pagePlugins, writePage } from './app.ts';

export const HOT_DIR = path.join(DIST_DESKTOP, 'hot');

const hostImports = (dir: string): Plugin => ({
  name: 'slick-host-imports',
  setup(builder) {
    onImportOutside(builder, dir, (file) => ({ path: repoPath(file), namespace: 'slick-host' }));
    builder.onLoad({ filter: /.*/, namespace: 'slick-host' }, (args) => ({
      contents: `module.exports = globalThis.__slickHot.module(${JSON.stringify(args.path)});`,
      loader: 'js',
    }));
  },
});

export async function buildHotPlugin(name: string) {
  const dir = path.join(PLUGINS, name);
  const { outputFiles } = await build({
    ...(await pageBuildOptions({ debug: true })),
    stdin: {
      contents: `import P from './index'; globalThis.__slickHot.accept(P);`,
      resolveDir: dir,
      sourcefile: `hot:${name}`,
      loader: 'js',
    },
    plugins: [hostImports(dir), ...pagePlugins],
  });
  await writePage(path.join(HOT_DIR, `${name}.js`), outputFiles[0].text, 'hot', `hot/${name}.js`);
}
