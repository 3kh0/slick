export type ChangelogGroup = { title: string; items: string[] };
export type ChangelogRelease = { build: number | null; groups: ChangelogGroup[] };
export type Changelog = { preamble: string; releases: ChangelogRelease[] };

export const HIGHLIGHTS = 'Highlights';

const RELEASE = /^##\s+(?:Build\s+([1-9]\d*)|(Unreleased))\s*$/i;
const GROUP = /^###\s+(.+?)\s*$/;
const ITEM = /^[-*]\s+(.*)$/;

export function parseChangelog(markdown: string): Changelog {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const releases: ChangelogRelease[] = [];
  const preamble: string[] = [];
  let release: ChangelogRelease | null = null;
  let group: ChangelogGroup | null = null;
  let item = -1;

  for (const line of lines) {
    const heading = RELEASE.exec(line);
    if (heading) {
      release = { build: heading[1] ? Number(heading[1]) : null, groups: [] };
      releases.push(release);
      group = null;
      item = -1;
      continue;
    }
    if (!release) {
      preamble.push(line);
      continue;
    }
    if (/^##\s/.test(line)) {
      release = null;
      continue;
    }
    const title = GROUP.exec(line);
    if (title) {
      group = { title: title[1], items: [] };
      release.groups.push(group);
      item = -1;
      continue;
    }
    const bullet = ITEM.exec(line);
    if (bullet) {
      if (!group) {
        group = { title: '', items: [] };
        release.groups.push(group);
      }
      item = group.items.push(bullet[1].trim()) - 1;
      continue;
    }
    if (group && item >= 0 && /^\s+\S/.test(line)) group.items[item] += ` ${line.trim()}`;
    else if (!line.trim()) item = -1;
  }

  for (const r of releases) r.groups = r.groups.filter((g) => g.items.length);
  return { preamble: preamble.join('\n').trimEnd(), releases };
}

export function formatChangelog({ preamble, releases }: Changelog): string {
  const out = [preamble, ''];
  for (const release of releases) {
    out.push(release.build === null ? '## Unreleased' : `## Build ${release.build}`, '');
    for (const group of release.groups) {
      if (group.title) out.push(`### ${group.title}`, '');
      for (const item of group.items) out.push(`- ${item}`);
      out.push('');
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

export const itemKey = (group: string, item: string) => `${group}\n${item}`;

export function releaseKeys(release: ChangelogRelease | undefined): Set<string> {
  const keys = new Set<string>();
  for (const group of release?.groups ?? []) for (const item of group.items) keys.add(itemKey(group.title, item));
  return keys;
}

function take(pool: ChangelogGroup[], keys: Set<string>): ChangelogGroup[] {
  const taken: ChangelogGroup[] = [];
  for (const group of pool) {
    const moved = group.items.filter((item) => keys.has(itemKey(group.title, item)));
    if (!moved.length) continue;
    group.items = group.items.filter((item) => !keys.has(itemKey(group.title, item)));
    taken.push({ title: group.title, items: moved });
  }
  return taken;
}

export type TaggedUnreleased = { build: number; unreleased: ChangelogRelease | undefined };

/**
 * Moves Unreleased entries under the builds that shipped them. `tags` holds
 * the Unreleased section as it was at each release tag: what is new at a tag
 * since the previous one shipped in that build, even before the cut PR lands.
 * With `current`, everything still unreleased ships in that build.
 */
export function cutChangelog(changelog: Changelog, tags: TaggedUnreleased[], current?: number): Changelog {
  const known = new Set(changelog.releases.map((r) => r.build).filter((b): b is number => b !== null));
  const unreleased = changelog.releases.find((r) => r.build === null);
  const pool: ChangelogGroup[] = structuredClone(unreleased?.groups ?? []);
  const cut: ChangelogRelease[] = [];
  let previous = new Set<string>();
  for (const tag of [...tags].toSorted((a, b) => a.build - b.build)) {
    const keys = releaseKeys(tag.unreleased);
    if (!known.has(tag.build) && tag.build !== current) {
      const fresh = new Set([...keys].filter((key) => !previous.has(key)));
      const groups = take(pool, fresh);
      if (groups.length) cut.push({ build: tag.build, groups });
      known.add(tag.build);
    }
    previous = keys;
  }
  if (current !== undefined && !known.has(current) && pool.some((g) => g.items.length)) {
    cut.push({ build: current, groups: pool.splice(0).filter((g) => g.items.length) });
  }

  const released = [...changelog.releases.filter((r) => r.build !== null), ...cut].toSorted(
    (a, b) => (b.build ?? 0) - (a.build ?? 0),
  );
  return {
    preamble: changelog.preamble,
    releases: [{ build: null, groups: pool.filter((g) => g.items.length) }, ...released],
  };
}

export function hasHighlights(releases: ChangelogRelease[]): boolean {
  return releases.some((r) => r.groups.some((g) => g.title === HIGHLIGHTS && g.items.length));
}

/** Releases after `after`, without entries the reader's own changelog already lists. */
export function newerThan(
  releases: ChangelogRelease[],
  after: number,
  seen: ChangelogRelease[] = [],
): ChangelogRelease[] {
  const known = new Set(seen.flatMap((r) => [...releaseKeys(r)]));
  return releases
    .filter((r) => r.build !== null && r.build > after)
    .map((r) => ({
      build: r.build,
      groups: r.groups
        .map((g) => ({ title: g.title, items: g.items.filter((item) => !known.has(itemKey(g.title, item))) }))
        .filter((g) => g.items.length),
    }))
    .filter((r) => r.groups.length);
}
