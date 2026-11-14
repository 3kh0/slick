import type { RtmEvent } from '../../app/slack/rtm.ts';

const slackId = /^[CDG][A-Z0-9]+$/;
const timestamp = /^\d+\.\d{6}$/;

export function resolveSlackLink(link: string, fallbackTeam?: string) {
  const url = new URL(link);
  if (url.username || url.password) throw new Error('Slack links must not contain credentials');
  if (url.protocol !== 'slack:' && (url.protocol !== 'https:' || !/(^|\.)slack\.com$/.test(url.hostname)))
    throw new Error('Expected a Slack HTTPS URL or slack:// deep link');
  const path = url.pathname.split('/').filter(Boolean);
  const team = url.searchParams.get('team') || (path[0] === 'client' ? path[1] : undefined) || fallbackTeam;
  if (team && !/^[TE][A-Z0-9]+$/.test(team)) throw new Error('Invalid workspace ID');
  const user = url.protocol === 'slack:' && url.hostname === 'user' ? url.searchParams.get('id') : undefined;
  if (user) {
    if (!/^[UW][A-Z0-9]+$/.test(user)) throw new Error('Invalid Slack user ID');
    const params = new URLSearchParams({ id: user, ...(team ? { team } : {}) });
    return { kind: 'profile', workspace_id: team, user_id: user, slack_uri: `slack://user?${params}` };
  }
  const channel =
    url.protocol === 'slack:'
      ? url.searchParams.get('id') || url.searchParams.get('channel')
      : path[0] === 'archives'
        ? path[1]
        : path[0] === 'client'
          ? path[2]
          : undefined;
  if (!channel || !slackId.test(channel)) throw new Error('This link does not identify a Slack channel or message');
  const compact = path.find((part) => /^p\d{7,}$/.test(part))?.slice(1);
  const message = compact
    ? `${compact.slice(0, -6)}.${compact.slice(-6)}`
    : url.searchParams.get('message_ts') || url.searchParams.get('message') || undefined;
  const thread = url.searchParams.get('thread_ts') || undefined;
  if ((message && !timestamp.test(message)) || (thread && !timestamp.test(thread)))
    throw new Error('Invalid Slack message timestamp');
  const params = new URLSearchParams({ id: channel, ...(team ? { team } : {}) });
  if (message) params.set('message', message);
  if (thread) params.set('thread_ts', thread);
  return {
    kind: thread ? 'thread' : message ? 'message' : 'channel',
    workspace_id: team,
    channel_id: channel,
    message_ts: message,
    thread_ts: thread,
    slack_uri: `slack://channel?${params}`,
  };
}

export function unreadConversations(counts: Record<string, any>, offset: number, limit: number) {
  const entries = (['channels', 'mpims', 'ims'] as const).flatMap((type) =>
    (Array.isArray(counts[type]) ? counts[type] : [])
      .filter((item: any) => item.has_unreads || Number(item.mention_count) > 0)
      .map((item: any) => ({
        id: item.id,
        type,
        has_unreads: !!item.has_unreads,
        mention_count: Number(item.mention_count) || 0,
        last_read: item.last_read,
        latest: item.latest,
      })),
  );
  return {
    total: entries.length,
    total_mentions: entries.reduce((sum, item) => sum + item.mention_count, 0),
    conversations: entries.slice(offset, offset + limit),
    next_offset: offset + limit < entries.length ? offset + limit : null,
  };
}

export type EventFilter = {
  event_type: string;
  channel?: string;
  user?: string;
  thread_ts?: string;
  after_ts?: string;
  timeout_ms: number;
  include_content?: boolean;
};

export function eventMatches(event: RtmEvent, filter: EventFilter): boolean {
  const item = event.item as Record<string, any> | undefined;
  const message = event.message as Record<string, any> | undefined;
  const ts = event.ts || event.event_ts || item?.ts || message?.ts;
  return (
    (filter.event_type === '*' || event.type === filter.event_type || event.subtype === filter.event_type) &&
    (!filter.channel || (event.channel || item?.channel) === filter.channel) &&
    (!filter.user || (event.user || message?.user) === filter.user) &&
    (!filter.thread_ts || (event.thread_ts || message?.thread_ts || item?.ts || event.ts) === filter.thread_ts) &&
    (!filter.after_ts || (typeof ts === 'string' && Number(ts) > Number(filter.after_ts)))
  );
}

export function eventSummary(event: RtmEvent) {
  return {
    type: event.type,
    subtype: event.subtype,
    channel: event.channel || event.item?.channel,
    user: event.user,
    ts: event.ts || event.event_ts || event.item?.ts || event.message?.ts,
    thread_ts: event.thread_ts || event.message?.thread_ts,
    reaction: event.reaction,
  };
}

export function waitForEvent(
  subscribe: (listener: (event: RtmEvent) => void) => () => void,
  filter: EventFilter,
  signal: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Event wait cancelled'));
      return;
    }
    let remove = () => {};
    let done = false;
    const finish = (value?: unknown, error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      remove();
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(undefined, new Error('Event wait cancelled'));
    const timer = setTimeout(() => finish({ timed_out: true }), filter.timeout_ms);
    signal.addEventListener('abort', abort, { once: true });
    try {
      remove = subscribe((event) => {
        if (eventMatches(event, filter))
          finish({ timed_out: false, event: filter.include_content ? event : eventSummary(event) });
      });
      if (done) remove();
    } catch (error) {
      finish(undefined, error instanceof Error ? error : new Error(String(error)));
    }
  });
}
