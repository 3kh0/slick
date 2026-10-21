// `bun run build:plugin <plugin dir or entry file> [out.js]`; see scripts/build/plugin.ts.

import { buildUserPlugin } from './build/plugin.ts';

const [input, out] = process.argv.slice(2);
if (!input) {
  console.error('Usage: bun run build:plugin <plugin dir or entry file> [out.js]');
  process.exit(1);
}
try {
  await buildUserPlugin(input, out);
} catch (error) {
  console.error(`[build:plugin] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
