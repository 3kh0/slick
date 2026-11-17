import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { cutChangelog, formatChangelog, hasHighlights, newerThan, parseChangelog } from './changelog.ts';

const FILE = `# Changelog

Intro text.

## Unreleased

### Highlights

- Big thing
  that wraps

### Fixed

- Small fix

## Build 10

- Ungrouped
`;

const unreleased = (...items: string[]) => ({ build: null, groups: [{ title: 'New', items }] });

test('parses releases, groups and wrapped items, and formats back', () => {
  const log = parseChangelog(FILE);
  assert.equal(log.preamble, '# Changelog\n\nIntro text.');
  assert.deepEqual(log.releases, [
    {
      build: null,
      groups: [
        { title: 'Highlights', items: ['Big thing that wraps'] },
        { title: 'Fixed', items: ['Small fix'] },
      ],
    },
    { build: 10, groups: [{ title: '', items: ['Ungrouped'] }] },
  ]);
  assert.deepEqual(parseChangelog(formatChangelog(log)), log);
  assert.ok(hasHighlights(log.releases));
});

test('legacy second-level group headings retain all release entries', () => {
  const legacy = FILE.replace('### Highlights', '## Highlights');
  assert.deepEqual(parseChangelog(legacy), parseChangelog(FILE));
  assert.match(formatChangelog(parseChangelog(legacy)), /### Highlights/);
});

test('a release build takes everything still unreleased', () => {
  const cut = cutChangelog(parseChangelog(FILE), [], 11);
  assert.deepEqual(
    cut.releases.map((r) => r.build),
    [null, 11, 10],
  );
  assert.deepEqual(cut.releases[0].groups, []);
  assert.equal(cut.releases[1].groups.length, 2);
});

test('entries are credited to the tag that first shipped them even when the cut PR lagged', () => {
  const log = { preamble: '', releases: [unreleased('a', 'b', 'c'), { build: 10, groups: [] }] };
  const tags = [
    { build: 10, unreleased: unreleased() },
    { build: 11, unreleased: unreleased('a') },
    { build: 12, unreleased: unreleased('a', 'b') },
  ];
  const released = cutChangelog(log, tags, 13).releases;
  assert.deepEqual(
    released.map((r) => [r.build, r.groups.flatMap((g) => g.items)]),
    [
      [null, []],
      [13, ['c']],
      [12, ['b']],
      [11, ['a']],
      [10, []],
    ],
  );

  const bot = cutChangelog(log, tags).releases;
  assert.deepEqual(bot[0].groups[0].items, ['c'], 'without a current build, unshipped entries stay unreleased');
});

test('builds already cut are left alone', () => {
  const log = parseChangelog('## Unreleased\n\n- new\n\n## Build 11\n\n- a\n');
  const cut = cutChangelog(log, [{ build: 11, unreleased: { build: null, groups: [{ title: '', items: ['a'] }] } }]);
  assert.deepEqual(cut.releases[0].groups[0].items, ['new']);
  assert.deepEqual(cut.releases[1], { build: 11, groups: [{ title: '', items: ['a'] }] });
});

test('newerThan drops builds and entries the reader already has', () => {
  const remote = parseChangelog('## Build 12\n\n- old\n- fresh\n\n## Build 11\n\n- older\n').releases;
  const local = parseChangelog('## Build 11\n\n- old\n- older\n').releases;
  assert.deepEqual(newerThan(remote, 11, local), [{ build: 12, groups: [{ title: '', items: ['fresh'] }] }]);
});

const releaseScript = fileURLToPath(new URL('../../scripts/ci/commit-release.sh', import.meta.url));
const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

function releaseFixture(t: { after: (fn: () => void) => void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const remote = path.join(root, 'remote.git');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(repo);
  fs.mkdirSync(bin);
  const git = (...args: string[]) =>
    execFileSync(realGit, args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--bare', remote);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release@test.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  fs.mkdirSync(path.join(repo, 'packaging/nix'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '## Unreleased\n\n- new\n');
  fs.writeFileSync(path.join(repo, 'packaging/nix/pins.json'), '{"build":158}\n');
  fs.writeFileSync(path.join(repo, 'source.txt'), 'reviewed code\n');
  git('add', '.');
  git('commit', '-m', 'reviewed source');
  git('tag', '-a', 'v159', '-m', 'request');
  git('remote', 'add', 'origin', remote);
  git('push', 'origin', 'HEAD:refs/heads/main', 'refs/tags/v159');
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf "%s\\n" "${MOCK_RELEASES:-}"\n', { mode: 0o755 });
  fs.writeFileSync(
    path.join(bin, 'git'),
    '#!/bin/sh\nif [ "$1" = push ] && [ "$2" = --atomic ] && [ -n "${RACE_MAIN:-}" ]; then\n  "$REAL_GIT" --git-dir="$REMOTE" update-ref refs/heads/main "$RACE_MAIN"\nfi\nexec "$REAL_GIT" "$@"\n',
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    REAL_GIT: realGit,
    REMOTE: remote,
    GITHUB_REPOSITORY: 'local/test',
    GITHUB_OUTPUT: path.join(root, 'output'),
  };
  const run = (extra = {}) =>
    spawnSync('bash', [releaseScript, 'v159'], { cwd: repo, env: { ...env, ...extra }, encoding: 'utf8' });
  const ref = (name: string) => git('--git-dir', remote, 'rev-parse', name);
  const prepare = () => {
    fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '## Unreleased\n\n## Build 159\n\n- new\n');
    fs.writeFileSync(path.join(repo, 'packaging/nix/pins.json'), '{"build":159}\n');
  };
  return { repo, remote, git, run, ref, prepare };
}

test('release commit atomically updates main and the tag, and retries preserve the tag object', (t) => {
  const f = releaseFixture(t);
  f.prepare();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.ref('refs/heads/main'), f.ref('refs/tags/v159^{commit}'));
  const tag = f.ref('refs/tags/v159');
  assert.equal(f.run({ MOCK_RELEASES: 'v159' }).status, 0);
  assert.equal(f.ref('refs/tags/v159'), tag);
});

test('an already published preparation commit can catch main up without retagging', (t) => {
  const f = releaseFixture(t);
  f.prepare();
  f.git('add', '.');
  f.git('commit', '-m', 'chore(release): prepare v159');
  f.git('tag', '-fa', 'v159', '-m', 'prepared');
  f.git('push', '--force', 'origin', 'refs/tags/v159');
  const tag = f.ref('refs/tags/v159');
  const result = f.run({ MOCK_RELEASES: 'v159' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.ref('refs/heads/main'), f.ref('refs/tags/v159^{commit}'));
  assert.equal(f.ref('refs/tags/v159'), tag);
});

test('a concurrent main push rejects the whole release transaction', (t) => {
  const f = releaseFixture(t);
  const original = f.git('rev-parse', 'HEAD');
  const tag = f.ref('refs/tags/v159');
  fs.writeFileSync(path.join(f.repo, 'source.txt'), 'newer reviewed code\n');
  f.git('commit', '-am', 'concurrent change');
  const newer = f.git('rev-parse', 'HEAD');
  f.git('push', 'origin', 'HEAD:refs/heads/concurrent');
  f.git('reset', '--hard', original);
  f.prepare();
  const result = f.run({ RACE_MAIN: newer });
  assert.notEqual(result.status, 0);
  assert.equal(f.ref('refs/heads/main'), newer);
  assert.equal(f.ref('refs/tags/v159'), tag);
});

test('a stale request cannot overwrite main, and published source cannot change', (t) => {
  const f = releaseFixture(t);
  const original = f.git('rev-parse', 'HEAD');
  const tag = f.ref('refs/tags/v159');
  f.prepare();
  assert.notEqual(f.run({ MOCK_RELEASES: 'v159' }).status, 0);
  assert.equal(f.ref('refs/heads/main'), original);
  assert.equal(f.ref('refs/tags/v159'), tag);
  f.git('reset', '--hard', original);
  fs.writeFileSync(path.join(f.repo, 'source.txt'), 'newer reviewed code\n');
  f.git('commit', '-am', 'main advanced');
  f.git('push', 'origin', 'HEAD:refs/heads/main');
  const newer = f.git('rev-parse', 'HEAD');
  f.git('reset', '--hard', original);
  f.prepare();
  assert.notEqual(f.run().status, 0);
  assert.equal(f.ref('refs/heads/main'), newer);
  assert.equal(f.ref('refs/tags/v159'), tag);
});

test('release credentials cannot carry unrelated source changes onto main', (t) => {
  const f = releaseFixture(t);
  const original = f.ref('refs/heads/main');
  fs.writeFileSync(path.join(f.repo, 'source.txt'), 'unreviewed code\n');
  assert.notEqual(f.run().status, 0);
  f.git('commit', '-am', 'unreviewed code');
  f.git('tag', '-fa', 'v159', '-m', 'unreviewed');
  assert.notEqual(f.run().status, 0);
  assert.equal(f.ref('refs/heads/main'), original);
});

test('branch protection rejection leaves the release tag untouched', (t) => {
  const f = releaseFixture(t);
  const main = f.ref('refs/heads/main');
  const tag = f.ref('refs/tags/v159');
  fs.writeFileSync(path.join(f.remote, 'hooks/update'), '#!/bin/sh\n[ "$1" != refs/heads/main ]\n', { mode: 0o755 });
  f.prepare();
  assert.notEqual(f.run().status, 0);
  assert.equal(f.ref('refs/heads/main'), main);
  assert.equal(f.ref('refs/tags/v159'), tag);
});
