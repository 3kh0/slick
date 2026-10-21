// Dev hot reload: bundles one plugin on its own. Files in the plugin's directory
// are compiled in; anything else under src/ is the page's live copy, looked up
// in a hot slick.js (buildApp({ hot: true })) instead of duplicated.

import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import { repoPath } from '../lib/plugin.ts';
import { DIST_DESKTOP, PLUGINS, SRC } from '../lib/paths.ts';
import { pageBuildOptions, pagePlugins, writePage } from './app.ts';

export const HOT_DIR = path.join(DIST_DESKTOP, 'hot');

const RESOLVING = Symbol('resolving');

const hostImports = (dir: string): Plugin => ({
  name: 'slick-host-imports',
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, async ({ path: p, kind, importer, resolveDir, pluginData }) => {
      if (pluginData === RESOLVING) return;
      const r = await builder.resolve(p, { kind, importer, resolveDir, pluginData: RESOLVING });
      if (r.errors.length) return { errors: r.errors };
      return r.namespace === 'file' && r.path.startsWith(SRC + path.sep) && !r.path.startsWith(dir + path.sep)
        ? { path: repoPath(r.path), namespace: 'slick-host' }
        : { path: r.path, namespace: r.namespace, external: r.external, sideEffects: r.sideEffects };
    });
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
