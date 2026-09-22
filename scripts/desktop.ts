// Dev runner: build the loader, then launch it with the project's Electron.
// `node scripts/desktop.ts [--safe-mode]`

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { buildDesktop } from './build/desktop.ts';
import { DIST_DESKTOP, ROOT } from './lib/paths.ts';

// The same Electron electron-builder packages, so dev and release agree. The
// package's main export is the path to its binary.
const electron = String(createRequire(import.meta.url)('electron'));
if (!existsSync(electron)) {
  console.error(`No Electron at ${electron}. Run: bun install`);
  process.exit(1);
}

await buildDesktop({ debug: true });

// Dev runs get their own profile so an experiment can never mangle the real
// Slick install's signed-in session. Point SLICK_HANDOFF_PROFILE at
// "~/Library/Application Support/Slick" to reuse it deliberately.
const profile = process.env.SLICK_HANDOFF_PROFILE || path.join(ROOT, 'work', 'dev-profile');
console.log(`[dev] profile: ${profile}`);

const child = spawn(electron, [DIST_DESKTOP, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', SLICK_HANDOFF_PROFILE: profile },
});
child.on('exit', (code) => process.exit(code ?? 0));
