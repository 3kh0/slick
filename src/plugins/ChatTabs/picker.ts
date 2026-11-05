import { restoreTabs, tabKey, type ChatTab } from './tabs.ts';

export type PickerPlace = { tab: ChatTab; label: string; searchText?: string; recent?: boolean };

export function recentPlaces(history: unknown, teamId: string): ChatTab[] {
  if (!Array.isArray(history)) return [];
  const entries = history
    .filter((entry) => entry?.teamId === teamId)
    .toSorted((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
  return restoreTabs(
    entries.flatMap((entry) => {
      const view = typeof entry.activeTab === 'string' ? entry[entry.activeTab]?.primary : undefined;
      if (view?.viewType === 'Channel') return [{ channel: view.id }];
      if (view?.viewType !== 'Thread' || typeof view.params?.threadId !== 'string') return [];
      const match = /^([CDG][A-Z0-9]+)-(\d{10,}\.\d{6})$/.exec(view.params.threadId);
      return match ? [{ channel: match[1], thread: match[2] }] : [];
    }),
  ).slice(0, 20);
}

const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

export function searchPlaces(places: PickerPlace[], query: string): PickerPlace[] {
  const seen = new Set<string>();
  const unique = places.filter((place) => {
    const key = tabKey(place.tab);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const terms = normalize(query)
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/^[#@]+/, ''))
    .filter(Boolean);
  if (!terms.length) {
    const recent = unique.filter((place) => place.recent);
    return recent.length ? recent.slice(0, 20) : unique.toSorted((a, b) => a.label.localeCompare(b.label)).slice(0, 30);
  }
  const full = terms.join(' ');
  return unique
    .map((place, index) => {
      const label = normalize(place.label);
      const text = normalize(`${place.label} ${place.searchText ?? ''}`);
      const score =
        label === full
          ? 0
          : label.startsWith(full)
            ? 1
            : terms.every((term) => label.split(/[\s,]+/).some((word) => word.startsWith(term)))
              ? 2
              : 3;
      return { place, index, text, score };
    })
    .filter(({ text }) => terms.every((term) => text.includes(term)))
    .toSorted(
      (a, b) =>
        a.score - b.score ||
        Number(!!b.place.recent) - Number(!!a.place.recent) ||
        (a.place.recent && b.place.recent ? a.index - b.index : a.place.label.localeCompare(b.place.label)),
    )
    .slice(0, 30)
    .map(({ place }) => place);
}
