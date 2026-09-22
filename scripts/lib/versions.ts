// Build number is the newest `v<N>` git tag; the updater compares it as an
// integer, so keep this scheme.

import { execFileSync } from 'node:child_process';
import { ROOT } from './paths.ts';

function git(...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function latestBuild(): number {
  const tags = git('tag', '--list', 'v[0-9]*')
    .split('\n')
    .map((tag) => Number.parseInt(tag.replace(/^v/, ''), 10))
    .filter((n) => Number.isFinite(n));
  return tags.length ? Math.max(...tags) : 0;
}

export const build = Number(process.env.SLICK_BUILD) || latestBuild();
export const commit = git('rev-parse', '--short', 'HEAD') || 'unknown';
export const version = process.env.SLICK_VERSION || (build ? `2.0.${build}` : `2.0.0-dev+${commit}`);

export const versions = { version, build, commit };
