// `bun scripts/changelog.ts notes <build>`: release notes for a build.
// `bun scripts/changelog.ts cut`: move entries every release tag shipped out of Unreleased.

import { writeFileSync } from 'node:fs';
import { formatChangelog } from '../src/shared/changelog.ts';
import { CHANGELOG, resolvedChangelog } from './lib/changelog.ts';

const [command, arg] = process.argv.slice(2);

if (command === 'notes') {
  const build = Number(arg);
  if (!Number.isInteger(build) || build < 1) {
    console.error('usage: changelog.ts notes <build>');
    process.exit(1);
  }
  const release = resolvedChangelog(build).releases.find((r) => r.build === build);
  const body = release ? formatChangelog({ preamble: '', releases: [release] }).replace(/^\s*## Build \d+\s*/, '') : '';
  process.stdout.write(body.trim() ? `${body.trim()}\n` : 'No user-facing changes in this build.\n');
} else if (command === 'cut') {
  writeFileSync(CHANGELOG, formatChangelog(resolvedChangelog()));
} else {
  console.error('usage: changelog.ts notes <build> | cut');
  process.exit(1);
}
