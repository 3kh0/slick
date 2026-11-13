import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  type Changelog,
  type ChangelogRelease,
  cutChangelog,
  parseChangelog,
  type TaggedUnreleased,
} from '../../src/shared/changelog.ts';
import { ROOT } from './paths.ts';

export const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const HISTORY_LIMIT = 40;

function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/** Unreleased as of each recent release tag; empty without git history (shallow CI checkouts). */
export function taggedHistory(changelog: Changelog, upTo = Infinity): TaggedUnreleased[] {
  const cutUpTo = Math.max(0, ...changelog.releases.map((r) => r.build ?? 0));
  const builds = (git('tag', '--list', 'v[0-9]*') ?? '')
    .split('\n')
    .map((tag) => Number(/^v([1-9]\d*)$/.exec(tag.trim())?.[1]))
    .filter((build) => build >= cutUpTo && build <= upTo)
    .toSorted((a, b) => a - b)
    .slice(-HISTORY_LIMIT);
  return builds.map((build) => {
    const text = git('show', `v${build}:CHANGELOG.md`);
    return { build, unreleased: text ? parseChangelog(text).releases.find((r) => r.build === null) : undefined };
  });
}

/** The changelog as a given build shipped it; Unreleased stays only for dev builds. */
export function resolvedChangelog(release?: number, file = CHANGELOG): Changelog {
  const changelog = parseChangelog(readFileSync(file, 'utf8'));
  const tags = taggedHistory(changelog, release === undefined ? Infinity : release - 1);
  return cutChangelog(changelog, tags, release);
}

export function bundledChangelog(release?: number, limit = 25): ChangelogRelease[] {
  return resolvedChangelog(release)
    .releases.filter((r) => r.groups.length)
    .slice(0, limit);
}
