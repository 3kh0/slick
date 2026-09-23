export type ChannelResult = {
  id?: string;
  name?: string;
  item?: { id?: string; name?: string };
};

export function normalizeChannelQuery(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^#/, '').toLowerCase() : '';
}

export function hasExactChannelResult(results: ChannelResult[], query: string): boolean {
  return results.some((result) => {
    const name = result.item?.name ?? result.name;
    return typeof name === 'string' && name.toLowerCase() === query;
  });
}

/** Union result lists by channel id. Slack's existing entries and ordering win. */
export function mergeChannelResults(base: ChannelResult[], extra: ChannelResult[]): ChannelResult[] {
  const seen = new Set(base.map((result) => result.item?.id ?? result.id).filter((id): id is string => !!id));
  const out = [...base];
  for (const result of extra) {
    const id = result.item?.id ?? result.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(result);
  }
  return out;
}
