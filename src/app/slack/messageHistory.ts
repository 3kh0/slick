// Pure channelHistory helpers for messages.ts (see there), split out so they
// test without booting the interceptors.

export type HistoryMessage = {
  ts?: string;
  thread_ts?: string;
  subtype?: string;
};

export type HistorySlice = {
  timestamps?: string[];
  start?: string;
  end?: string;
};

export type ChannelHistory = {
  slices?: HistorySlice[];
  /** Whether the oldest slice includes the conversation's first message. */
  reachedStart?: boolean;
  /** Whether the newest slice includes the latest message. */
  reachedEnd?: boolean;
};

export const historyKeyChannel = (key: string): string => key.split('-')[0];
export const historyKeyThread = (key: string): string | undefined =>
  key.includes('-') ? key.slice(key.indexOf('-') + 1) : undefined;

export function inHistory(msg: HistoryMessage, thread: string | undefined): boolean {
  const parent = typeof msg.thread_ts === 'string' ? msg.thread_ts : undefined;
  if (thread !== undefined) return parent === thread;
  // In the channel itself a reply only shows when it was also broadcast.
  return parent === undefined || parent === msg.ts || msg.subtype === 'thread_broadcast';
}

const THREAD_FIELDS = [
  'thread_ts',
  'reply_count',
  'reply_users',
  'reply_users_count',
  'latest_reply',
  'last_read',
  'subscribed',
] as const;

export function withLiveThread<T extends object>(injected: T, live: object | undefined): T {
  if (!live) return injected;
  let next: T | undefined;
  for (const field of THREAD_FIELDS) {
    if (!(field in live)) continue;
    const value = (live as Record<string, unknown>)[field];
    if ((injected as Record<string, unknown>)[field] === value) continue;
    next ??= { ...injected };
    (next as Record<string, unknown>)[field] = value;
  }
  return next ?? injected;
}

export function sliceCovers(history: ChannelHistory, slice: HistorySlice, position: number, ts: string): boolean {
  const last = (history.slices?.length ?? 0) - 1;
  const { start, end } = slice;
  return (
    (start === undefined || ts >= start || (position === 0 && history.reachedStart === true)) &&
    (end === undefined || ts <= end || (position === last && history.reachedEnd === true))
  );
}

export function withTimestamps(history: ChannelHistory, added: string[], excluded: string[] = []): HistorySlice[] {
  const slices = history.slices ?? [];
  const excludedSet = excluded.length > 8 ? new Set(excluded) : undefined;
  let changed = false;
  const next = slices.map((slice, position) => {
    const { timestamps } = slice;
    if (!Array.isArray(timestamps)) return slice;
    const kept = timestamps.filter((ts) => !(excludedSet ? excludedSet.has(ts) : excluded.includes(ts)));
    let present: Set<string> | undefined;
    const missing = added.filter((ts) => {
      if (!sliceCovers(history, slice, position, ts)) return false;
      // A few lookups are cheaper than building an index. Build it lazily so
      // timestamps outside this slice never index the whole history window.
      if (added.length <= 8) return !kept.includes(ts);
      present ??= new Set(kept);
      return !present.has(ts);
    });
    if (!missing.length && kept.length === timestamps.length) return slice;
    changed = true;
    // Slack timestamps are fixed-width, so they sort as plain strings.
    return { ...slice, timestamps: [...kept, ...missing].toSorted() };
  });
  return changed ? next : slices;
}
