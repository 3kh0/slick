export type ChannelName = { name: string; previousNames?: string[] };
export type ExportEntry = { latest?: unknown; private?: unknown; history?: Array<{ name?: unknown }> };

export const CHANNEL_ID = /^[CG][A-Z0-9]{6,}$/;

export function parseExport(value: unknown): Map<string, ChannelName> {
  const out = new Map<string, ChannelName>();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [id, raw] of Object.entries(value)) {
    if (!CHANNEL_ID.test(id) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as ExportEntry;
    if (entry.private !== true || typeof entry.latest !== 'string' || !entry.latest.trim()) continue;
    const name = entry.latest.trim().slice(0, 100);
    const previousNames = (Array.isArray(entry.history) ? entry.history : [])
      .map((item) => (typeof item?.name === 'string' ? item.name.trim().slice(0, 100) : ''))
      .filter((old) => old && old !== name);
    out.set(id, { name, ...(previousNames.length && { previousNames: [...new Set(previousNames)] }) });
  }
  return out;
}

export function candidatesFor(
  index: Map<string, ChannelName>,
  query: string,
  unavailable: (id: string) => boolean,
  limit: number,
): string[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const ranked: Array<{ id: string; name: string; rank: number }> = [];
  for (const [id, record] of index) {
    if (!unavailable(id)) continue;
    const names = [record.name, ...(record.previousNames ?? [])].map((name) => name.toLowerCase());
    const rank = Math.min(
      ...names.map((name) => (name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : 3)),
    );
    if (rank < 3) ranked.push({ id, name: record.name, rank });
  }
  return ranked
    .toSorted((a, b) => a.rank - b.rank || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ id }) => id);
}
