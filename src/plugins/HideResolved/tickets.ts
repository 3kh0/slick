export type Data = Record<string, any>;
export type Status = 'open' | 'resolved' | 'other';
export type Rules = { open: Set<string>; resolved: Set<string> };
export type History = { slices?: { timestamps?: string[] }[] } & Data;

export const parseList = (text: string): string[] =>
  text
    .split(/[\s,]+/)
    .map((item) =>
      item
        .trim()
        .replace(/^[#:]+|:+$/g, '')
        .toLowerCase(),
    )
    .filter(Boolean);

export function channelMatcher(text: string): (name: string | undefined) => boolean {
  const patterns = parseList(text).map(
    (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`),
  );
  return (name) => !!name && patterns.some((pattern) => pattern.test(name.toLowerCase()));
}

const baseName = (name: unknown) => (typeof name === 'string' ? name.split('::')[0].toLowerCase() : '');

export function reactionStatus(reactions: unknown, rules: Rules): Status {
  if (!Array.isArray(reactions)) return 'other';
  let resolved = false;
  for (const reaction of reactions) {
    if (!reaction || reaction.count === 0) continue;
    const name = baseName(reaction.name);
    if (rules.open.has(name)) return 'open';
    if (rules.resolved.has(name)) resolved = true;
  }
  return resolved ? 'resolved' : 'other';
}

export function ticketStatus(
  message: Data | undefined,
  messages: Data | undefined,
  reactions: Data | undefined,
  channelId: string,
  rules: Rules,
): Status {
  if (!message) return 'other';
  const root = message.thread_ts && message.thread_ts !== message.ts ? messages?.[message.thread_ts] : message;
  if (!root?.ts) return 'other';
  return reactionStatus(reactions?.[root._rxn_key ?? `message-${root.ts}-${channelId}`], rules);
}

export function hides(
  message: Data | undefined,
  messages: Data | undefined,
  reactions: Data | undefined,
  channelId: string,
  rules: Rules,
  notOpen: boolean,
): boolean {
  if (!message) return false;
  // Plain replies sit in channel history too, but Slack never draws them there.
  if (message.thread_ts && message.thread_ts !== message.ts && message.subtype !== 'thread_broadcast') return false;
  const status = ticketStatus(message, messages, reactions, channelId, rules);
  return status === 'resolved' || (notOpen && status === 'other');
}

// Jumping to a message (a link, search, Activity) sets highlightTs on the view showing it.
export function linkedTs(viewUiState: Data | undefined, channelId: string): string {
  const linked: string[] = [];
  for (const view in viewUiState) {
    const ts = viewUiState[view]?.[channelId]?.highlightTs;
    if (typeof ts === 'string') linked.push(ts);
  }
  return linked.join(',');
}

export function filterHistory(history: History, skip: (ts: string) => boolean): { history: History; hidden: number } {
  if (!Array.isArray(history.slices)) return { history, hidden: 0 };
  let hidden = 0;
  let changed = false;
  const slices = history.slices.map((slice) => {
    if (!Array.isArray(slice?.timestamps)) return slice;
    const timestamps = slice.timestamps.filter((ts) => !skip(ts));
    if (timestamps.length === slice.timestamps.length) return slice;
    hidden += slice.timestamps.length - timestamps.length;
    changed = true;
    return { ...slice, timestamps };
  });
  return { history: changed ? { ...history, slices } : history, hidden };
}
