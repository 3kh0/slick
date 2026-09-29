// Stages the runnable Electron app into dist/desktop/ (also packaging's input).

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

// main is ESM (import.meta.url, top-level await); preloads must be CJS.
const entries = [
  { entry: 'main.ts', out: 'main.js', format: 'esm' },
  { entry: 'preload.ts', out: 'preload.js', format: 'cjs' },
  { entry: 'windows/cssEditorPreload.ts', out: 'cssEditorPreload.js', format: 'cjs' },
] as const;

// The Monaco 0.57 files a CSS editor actually loads; the full min/vs is ~25 MB.
const MONACO_CSS_FILES = [
  'assets/css.worker-BpD9FCKP.js',
  'assets/editor.worker-_vAIFJDs.js',
  'assets/editorWebWorkerMain-DEgFqX2K.js',
  'assets/html.worker-CLuInTTy.js',
  'assets/json.worker-Csf_TLih.js',
  'assets/ts.worker-g3pjEjl4.js',
  'basic-languages/monaco.contribution.js',
  'css-CaeNmE3S.js',
  'css.worker-BInK4lsP.js',
  'cssMode-eIUIN_ru.js',
  'editor-BdtEMBbM.js',
  'editor/editor.main.css',
  'editor/editor.main.js',
  'editorWorkerHost-B_VpI68A.js',
  'html.worker-C1TNvQ72.js',
  'index-DZH_zysX.js',
  'json.worker-Bp7U0-9w.js',
  'loader.js',
  'lspLanguageFeatures-Cog3rVVE.js',
  'main-DsK8pnKg.js',
  'monaco.contribution-BuX2NvO2.js',
  'monaco.contribution-C7tY_xnl.js',
  'monaco.contribution-CY2lwFI8.js',
  'monaco.contribution-D1-wBxcq.js',
  'nls.messages-loader.js',
  'toggleHighContrast-DuqAmExZ.js',
  'ts.worker-BLYAhMkX.js',
  'workers-BeMslOxK.js',
] as const;

export async function buildDesktop({ debug = false } = {}) {
  await buildApp({ debug });
  await mkdir(DIST_DESKTOP, { recursive: true });

  // Main halves are fixed at build time via a generated module, so nothing
  // dropped into a plugins directory later gains Node access.
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
      banner:
        format === 'esm'
          ? {
              js: "import { createRequire as slickCreateRequire } from 'node:module'; const require = slickCreateRequire(import.meta.url);",
            }
          : undefined,
      target: 'node22',
      minify: !debug,
      sourcemap: debug ? 'inline' : false,
      external: ['electron'],
      plugins: [slickSharedAlias],
      define,
    });
    console.log(`[build:desktop] ${out}`);
  }

  // Served over slick://; session.ts resolves them relative to this dir in dev.
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
