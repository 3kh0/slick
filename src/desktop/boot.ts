// The app's entry point: runs code installed by a code-only update when it
// fits this app, otherwise the main.js packaged beside this file.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { codeRoot, markCodeBad, selectCode } from './codeBoot.ts';

const resources = process.env.SLICK_RESOURCES_PATH || process.resourcesPath;
let code: { dir: string; build: number } | null = null;
try {
  if (process.env.SLICK_CODE_UPDATES !== '0') code = selectCode(resources);
} catch (error) {
  console.error('[slick] could not check installed code:', error);
}

if (code) {
  process.env.SLICK_CODE_DIR = code.dir;
  process.env.SLICK_CODE_BUILD = String(code.build);
  console.log(`[slick] booting build ${code.build} from ${code.dir}`);
  try {
    await import(pathToFileURL(path.join(code.dir, 'main.js')).href);
  } catch (error) {
    console.error(`[slick] build ${code.build} failed to load; falling back:`, error);
    markCodeBad(codeRoot(), code.build, String(error));
    app.relaunch();
    app.exit(0);
  }
} else {
  delete process.env.SLICK_CODE_DIR;
  delete process.env.SLICK_CODE_BUILD;
  await import(pathToFileURL(path.join(import.meta.dirname, 'main.js')).href);
}
