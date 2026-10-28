export type Query = (
  teamId: string,
  request: { method: string; args: Record<string, unknown> },
) => Promise<{ results?: { id: string }[]; next_marker?: string }>;
export type Presence = Record<string, { presence?: string } | undefined>;

const PAGE = 100;

export async function channelPeople(query: Query, teamId: string, channelId: string, limit: number) {
  const ids: string[] = [];
  let marker: string | undefined;
  do {
    const page = await query(teamId, {
      method: 'users/list',
      args: {
        channels: [channelId],
        filter: 'everyone AND NOT bots AND NOT apps',
        count: PAGE,
        ...(marker && { marker }),
      },
    });
    ids.push(...(page.results ?? []).map((user) => user.id));
    marker = page.next_marker;
  } while (marker && ids.length < limit);
  return [...new Set(ids)].slice(0, limit);
}

export function tally(ids: readonly string[], presence: Presence | undefined) {
  let known = 0;
  let online = 0;
  for (const id of ids) {
    const state = presence?.[id]?.presence;
    if (state) known++;
    if (state === 'active') online++;
  }
  return { known, online };
}

/** `undefined` until Slack knows everyone's presence. */
export function onlineCount(ids: readonly string[], presence: Presence | undefined) {
  const { known, online } = tally(ids, presence);
  return known === ids.length ? online : undefined;
}

export function estimateOnline(people: number, online: number, sampled: number) {
  return sampled > 0 ? Math.round((people * online) / sampled) : undefined;
}
