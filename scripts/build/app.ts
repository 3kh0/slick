// Builds slick.js — the in-page bundle that runs before Slack's first script.

import { mkdir, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { APP, DIST_APP, ROOT, SLICK_JS } from '../lib/paths.ts'
import { versions } from '../lib/versions.ts'

const SOURCE_ORIGIN = 'slick:///'

export async function buildApp({ debug = false } = {}) {
  const result = await build({
    entryPoints: [`${APP}/main.ts`],
    absWorkingDir: ROOT,
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: !debug,
    sourcemap: debug ? 'inline' : false,
    define: {
      __SLICK_VERSION__: JSON.stringify(versions.version),
      __SLICK_BUILD__: JSON.stringify(versions.build),
      // The bundle is injected as a <script src>, so anything reaching for
      // Node globals is a bug; fail loudly rather than shipping a shim.
      process: 'undefined',
    },
  })

  let code = result.outputFiles[0].text
  // Without this the bundle shows up in DevTools as an anonymous script
  // attributed to app.slack.com.
  code += `\n//# sourceURL=${SOURCE_ORIGIN}slick.js\n`

  await mkdir(DIST_APP, { recursive: true })
  await writeFile(SLICK_JS, code)
  console.log(`[build:app] slick.js  ${(Buffer.byteLength(code) / 1024).toFixed(1)} KB`)
  return SLICK_JS
}
