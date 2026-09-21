// Builds the Electron loader into dist/desktop/.
//
// Phase 1 stages a runnable app directory (main.js + preload.js + slick.js);
// electron-builder packaging lands in Phase 6 and consumes this same stage.

import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { DESKTOP, DIST_DESKTOP, ROOT, SLICK_JS } from '../lib/paths.ts'
import { versions } from '../lib/versions.ts'
import { buildApp } from './app.ts'

const define = {
  __SLICK_VERSION__: JSON.stringify(versions.version),
  __SLICK_BUILD__: JSON.stringify(versions.build),
}

// main is ESM (it needs import.meta.url and top-level await); the preload has
// to be CJS because it runs `require('electron')` before any module wiring.
const entries = [
  { entry: 'main.ts', out: 'main.js', format: 'esm' },
  { entry: 'preload.ts', out: 'preload.js', format: 'cjs' },
] as const

export async function buildDesktop({ debug = false } = {}) {
  await buildApp({ debug })
  await mkdir(DIST_DESKTOP, { recursive: true })

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
      define,
    })
    console.log(`[build:desktop] ${out}`)
  }

  // slick.js is served from resources over slick://; session.ts resolves it
  // relative to process.resourcesPath, which in the dev stage is this directory.
  await copyFile(SLICK_JS, path.join(DIST_DESKTOP, 'slick.js'))

  await writeFile(
    path.join(DIST_DESKTOP, 'package.json'),
    `${JSON.stringify({ name: 'slick', version: versions.version, main: 'main.js', type: 'module' }, null, 2)}\n`,
  )

  console.log(`[build:desktop] staged ${DIST_DESKTOP}`)
  return DIST_DESKTOP
}
