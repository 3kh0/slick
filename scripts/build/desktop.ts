// Builds the Electron loader into dist/desktop/.
//
// Phase 1 stages a runnable app directory (main.js + preload.js + slick.js);
// electron-builder packaging lands in Phase 6 and consumes this same stage.

import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { mainHalvesModule, slickSharedAlias } from '../lib/plugin.ts';
import { DESKTOP, DIST_DESKTOP, MONACO, ROOT, SLICK_JS, SRC } from '../lib/paths.ts';
import { versions } from '../lib/versions.ts';
import { buildApp } from './app.ts';

const define = {
  __SLICK_VERSION__: JSON.stringify(versions.version),
  __SLICK_BUILD__: JSON.stringify(versions.build),
};

// main is ESM (it needs import.meta.url and top-level await); the preload has
// to be CJS because it runs `require('electron')` before any module wiring.
const entries = [
  { entry: 'main.ts', out: 'main.js', format: 'esm' },
  { entry: 'preload.ts', out: 'preload.js', format: 'cjs' },
  { entry: 'windows/cssEditorPreload.ts', out: 'cssEditorPreload.js', format: 'cjs' },
] as const;

// Files requested by Monaco 0.56 while opening a CSS model, starting its CSS
// worker, and requesting validation/completions. The full min/vs tree is ~24 MB.
const MONACO_CSS_FILES = [
  'assets/css.worker-URu8fCFR.js',
  'assets/editor.worker-lj3bdIIn.js',
  'basic-languages/monaco.contribution.js',
  'css-CaeNmE3S.js',
  'css.worker-CyhWkhHo.js',
  'cssMode-CV6Ay48H.js',
  'editor-KLE6jdfb.js',
  'editor/editor.main.css',
  'editor/editor.main.js',
  'editorWorkerHost-fVE1cjcC.js',
  'html.worker-CA3iAimZ.js',
  'index-CBVt3dzv.js',
  'json.worker-BizpAl9O.js',
  'loader.js',
  'lspLanguageFeatures-BIkJOWLw.js',
  'main-DsK8pnKg.js',
  'monaco.contribution-9cKT3C7t.js',
  'monaco.contribution-BE88ZNGY.js',
  'monaco.contribution-BPhsneLd.js',
  'monaco.contribution-BgRy6xDf.js',
  'nls.messages-loader.js',
  'toggleHighContrast-qGX7E9o7.js',
  'ts.worker-2QLmBukE.js',
  'workers-BBttULjf.js',
] as const;

export async function buildDesktop({ debug = false } = {}) {
  await buildApp({ debug });
  await mkdir(DIST_DESKTOP, { recursive: true });

  // The set of privileged plugins is fixed at build time: main halves are
  // resolved from a generated module rather than discovered at runtime, so
  // nothing dropped into a plugins directory later gains Node access.
  const generated = path.join(SRC, 'desktop', 'mainPlugins.generated.ts');
  await writeFile(generated, mainHalvesModule());

  for (const { entry, out, format } of entries) {
    await build({
      entryPoints: [path.join(DESKTOP, entry)],
      absWorkingDir: ROOT,
      outfile: path.join(DIST_DESKTOP, out),
      bundle: true,
      platform: 'node',
      format,
      target: 'node22',
      minify: !debug,
      sourcemap: debug ? 'inline' : false,
      external: ['electron'],
      plugins: [slickSharedAlias],
      define,
    });
    console.log(`[build:desktop] ${out}`);
  }

  // slick.js and the trimmed Monaco runtime are served from resources over
  // slick://; session.ts resolves them relative to this directory in dev.
  await copyFile(SLICK_JS, path.join(DIST_DESKTOP, 'slick.js'));

  const monacoStage = path.join(DIST_DESKTOP, 'monaco', 'vs');
  await rm(path.dirname(monacoStage), { recursive: true, force: true });
  for (const relative of MONACO_CSS_FILES) {
    const destination = path.join(monacoStage, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(MONACO, relative), destination);
  }

  await writeFile(
    path.join(DIST_DESKTOP, 'package.json'),
    `${JSON.stringify({ name: 'slick', version: versions.version, main: 'main.js', type: 'module' }, null, 2)}\n`,
  );

  console.log(`[build:desktop] staged ${DIST_DESKTOP}`);
  return DIST_DESKTOP;
}
