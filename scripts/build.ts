// Build entry point. `node scripts/build.ts [app|desktop|package] [--debug] [--arch <arch>]`

import { buildApp } from './build/app.ts';
import { buildDesktop } from './build/desktop.ts';
import { packageDesktop } from './build/package.ts';

const args = process.argv.slice(2);
const debug = args.includes('--debug');
const archIndex = args.indexOf('--arch');
const arch = archIndex < 0 ? undefined : args[archIndex + 1];
if (archIndex >= 0 && (!arch || arch.startsWith('--'))) {
  console.error('--arch needs a value');
  process.exit(1);
}
// Guard the -1: without it `archIndex + 1` is 0 and the first positional
// argument is eaten, so `build.ts package` silently built `desktop` instead.
const archValueIndex = archIndex < 0 ? -1 : archIndex + 1;
const targets = args.filter((arg, index) => !arg.startsWith('--') && index !== archValueIndex);

const all = { app: buildApp, desktop: buildDesktop, package: packageDesktop };
const chosen = targets.length ? targets : ['desktop'];

for (const target of chosen) {
  const fn = all[target as keyof typeof all];
  if (!fn) {
    console.error(`unknown target: ${target} (try: ${Object.keys(all).join(', ')})`);
    process.exit(1);
  }
  await fn({ debug, arch });
}
