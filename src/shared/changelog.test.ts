import assert from 'node:assert/strict';
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
