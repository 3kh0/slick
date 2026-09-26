// Build entry point. `node scripts/build.ts [app|desktop|package] [--debug] [--arch <arch>]`

import { buildApp } from './build/app.ts';
import { buildDesktop } from './build/desktop.ts';
import { packageDesktop } from './build/package.ts';
import { buildExtension } from './build/extension.ts';

const args = process.argv.slice(2);
const debug = args.includes('--debug');
const archIndex = args.indexOf('--arch');
const arch = archIndex < 0 ? undefined : args[archIndex + 1];
if (archIndex >= 0 && (!arch || arch.startsWith('--'))) {
  console.error('--arch needs a value');
  process.exit(1);
}
// Without the -1 guard, archIndex + 1 is 0 and eats the first positional arg.
const archValueIndex = archIndex < 0 ? -1 : archIndex + 1;
const targets = args.filter((arg, index) => !arg.startsWith('--') && index !== archValueIndex);

const all = { app: buildApp, desktop: buildDesktop, package: packageDesktop, firefox: buildExtension };
const chosen = targets.length ? targets : ['desktop'];

for (const target of chosen) {
  const fn = all[target as keyof typeof all];
  if (!fn) {
    console.error(`unknown target: ${target} (try: ${Object.keys(all).join(', ')})`);
    process.exit(1);
  }
  await fn({ debug, arch });
}
