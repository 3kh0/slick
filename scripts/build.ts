// Build entry point. `node scripts/build.ts [app|desktop] [--debug]`

import { buildApp } from './build/app.ts';
import { buildDesktop } from './build/desktop.ts';

const args = process.argv.slice(2);
const debug = args.includes('--debug');
const targets = args.filter((arg) => !arg.startsWith('--'));

const all = { app: buildApp, desktop: buildDesktop };
const chosen = targets.length ? targets : ['desktop'];

for (const target of chosen) {
  const fn = all[target as keyof typeof all];
  if (!fn) {
    console.error(`unknown target: ${target} (try: ${Object.keys(all).join(', ')})`);
    process.exit(1);
  }
  await fn({ debug });
}
