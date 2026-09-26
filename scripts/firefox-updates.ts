import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [xpi, build, out] = process.argv.slice(2);
if (!xpi || !/^[1-9]\d*$/.test(build ?? '') || !out) {
  console.error('usage: node scripts/firefox-updates.ts <signed.xpi> <build> <out.json>');
  process.exit(1);
}

const manifest = JSON.parse(await readFile(new URL('../src/extension/firefox/manifest.json', import.meta.url), 'utf8'));
const id: string = manifest.browser_specific_settings.gecko.id;
const hash = createHash('sha256')
  .update(await readFile(xpi))
  .digest('hex');
const updates = {
  addons: {
    [id]: {
      updates: [
        {
          version: `2.0.${build}`,
          update_link: `https://github.com/3kh0/slick/releases/download/v${build}/${path.basename(xpi)}`,
          update_hash: `sha256:${hash}`,
        },
      ],
    },
  },
};
await writeFile(out, `${JSON.stringify(updates, null, 2)}\n`);
console.log(`[firefox] ${out}: ${id} 2.0.${build}`);
