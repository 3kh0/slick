import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import { ROOT } from '../lib/paths.ts';
import { versions } from '../lib/versions.ts';
import { USERSCRIPT_MAIN_PLUGINS } from '../../src/userscript/plugins.ts';
import { buildApp } from './app.ts';
import { backgroundPlugins } from './extension.ts';

export function userscriptMetadata() {
  return `// ==UserScript==
// @name Slick for Slack
// @namespace https://github.com/3kh0/slick
// @version 2.0.${versions.build}
// @description Customize Slack with Slick plugins, themes and custom CSS.
// @homepageURL https://slickclient.net
// @supportURL https://github.com/3kh0/slick/issues
// @downloadURL https://github.com/3kh0/slick/releases/latest/download/slick.user.js
// @updateURL https://github.com/3kh0/slick/releases/latest/download/slick.meta.js
// @match https://app.slack.com/client
// @match https://app.slack.com/client/*
// @run-at document-start
// @inject-into page
// @noframes
// @connect *
// @grant unsafeWindow
// @grant GM_getValue
// @grant GM_listValues
// @grant GM.setValue
// @grant GM.deleteValue
// @grant GM_addValueChangeListener
// @grant GM_removeValueChangeListener
// @grant GM_xmlhttpRequest
// @grant GM_registerMenuCommand
// ==/UserScript==
`;
}

export async function buildUserscript({ debug = false } = {}) {
  const output = path.join(ROOT, 'dist/userscript/slick.user.js');
  const workers = await Promise.all(
    ['editor/editor.worker', 'language/css/css.worker'].map(async (name) => {
      const result = await build({
        entryPoints: [path.join(ROOT, 'node_modules/monaco-editor/esm/vs', name + '.js')],
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'iife',
        minify: true,
      });
      return result.outputFiles[0]!.text;
    }),
  );
  const monacoAssets: Plugin = {
    name: 'userscript-monaco-assets',
    setup(builder) {
      builder.onResolve({ filter: /^slick:monaco-workers$/ }, () => ({ path: 'workers', namespace: 'monaco-workers' }));
      builder.onLoad({ filter: /.*/, namespace: 'monaco-workers' }, () => ({
        contents: `export const editorWorker=${JSON.stringify(workers[0])};export const cssWorker=${JSON.stringify(workers[1])};`,
        loader: 'js',
      }));
      builder.onLoad({ filter: /\.css$/ }, async ({ path: filename }) => ({
        contents: `import {monacoStyles} from ${JSON.stringify(path.join(ROOT, 'src/userscript/monacoStyles.ts'))};monacoStyles.push(${JSON.stringify(await readFile(filename, 'utf8'))});`,
        loader: 'js',
      }));
    },
  };
  const editor = await build({
    entryPoints: [path.join(ROOT, 'src/userscript/monaco.ts')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'slickMonacoBundle',
    target: 'es2022',
    minify: true,
    plugins: [monacoAssets],
  });
  const monacoSource: Plugin = {
    name: 'userscript-lazy-monaco',
    setup(builder) {
      builder.onResolve({ filter: /^slick:monaco-source$/ }, () => ({ path: 'editor', namespace: 'monaco-source' }));
      builder.onLoad({ filter: /.*/, namespace: 'monaco-source' }, () => ({
        contents: `export default ${JSON.stringify(editor.outputFiles[0]!.text)};`,
        loader: 'js',
      }));
    },
  };
  await buildApp({
    debug,
    targetLoader: 'userscript',
    entryPoint: 'src/userscript/entry.ts',
    outFile: output,
    extraPlugins: [backgroundPlugins(USERSCRIPT_MAIN_PLUGINS), monacoSource],
  });
  const metadata = userscriptMetadata();
  await writeFile(output, metadata + (await readFile(output, 'utf8')));
  await writeFile(path.join(ROOT, 'dist/userscript/slick.meta.js'), metadata);
  console.log('[build:userscript] dist/userscript/slick.user.js + slick.meta.js');
  return output;
}
