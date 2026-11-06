// Single-file user plugins: a plugin's own files bundled as CommonJS inside a
// factory queued on `globalThis.__slickPlugins`, with `$slick` left for the page
// to provide (src/app/userPlugins.ts). The .user.js twin is for userscript managers.

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
  const code = `(globalThis.__slickPlugins ??= []).push((require) => {
var module = { exports: {} }, exports = module.exports;
${outputFiles[0].text}return module.exports.default;
});
`;
  const meta = describe(code, name);
  const file = path.resolve(out ?? path.join(DIST, 'plugins', `${name}.js`));
  await writePage(file, `// slick-plugin ${JSON.stringify(meta)}\n${code}`, 'plugin', `plugins/${name}.js`);
  await writePage(
    file.replace(/(\.js)?$/, '.user.js'),
    userscriptHeader(meta) + code,
    'plugin',
    `plugins/${name}.user.js`,
  );
  return file;
}

/** Reads the plugin's statics by running it against a stub `$slick`. */
function describe(code: string, fallback: string) {
  class SlickPlugin {
    start() {}
  }
  const queue: ((require: () => unknown) => Record<string, unknown> | undefined)[] = [];
  const text = (value: unknown, or: string) => (typeof value === 'string' && value ? value : or);
  try {
    new Function('globalThis', code)({ __slickPlugins: queue });
    const PluginClass = queue[0]?.(() => ({ __esModule: true, SlickPlugin }));
    const id = text(PluginClass?.id, fallback);
    return { id, name: text(PluginClass?.pluginName, id), description: text(PluginClass?.description, '') };
  } catch {
    return { id: fallback, name: fallback, description: '' };
  }
}

function userscriptHeader({ id, name, description }: ReturnType<typeof describe>) {
  const tags = [
    ['name', `Slick: ${name}`],
    ['namespace', `slick-plugin/${id}`],
    ['description', description],
    ['match', 'https://app.slack.com/client'],
    ['match', 'https://app.slack.com/client/*'],
    ['run-at', 'document-start'],
    ['inject-into', 'page'],
    ['grant', 'none'],
    ['noframes', ''],
  ];
  const lines = tags.filter(([key, value]) => value || key === 'noframes');
  return `// ==UserScript==\n${lines.map(([key, value]) => `// @${key} ${value.replace(/\s+/g, ' ')}`.trimEnd() + '\n').join('')}// ==/UserScript==\n`;
}
