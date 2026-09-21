// Build entry point. `node scripts/build.ts [app|desktop|package] [--debug]`

import { buildApp } from './build/app.ts';
import { buildDesktop } from './build/desktop.ts';
import { packageDesktop } from './build/package.ts';

const args = process.argv.slice(2);
const debug = args.includes('--debug');
const targets = args.filter((arg) => !arg.startsWith('--'));

const all = { app: buildApp, desktop: buildDesktop, package: packageDesktop };
const chosen = targets.length ? targets : ['desktop'];

for (const target of chosen) {
  const fn = all[target as keyof typeof all];
  if (!fn) {
    console.error(`unknown target: ${target} (try: ${Object.keys(all).join(', ')})`);
    process.exit(1);
  }
  await fn({ debug });
}
