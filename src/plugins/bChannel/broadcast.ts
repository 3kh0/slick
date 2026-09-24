// Detect @channel / @here in composer content and turn typed mentions into
// Block Kit broadcasts. Pure, so it can be tested without Slack.

export type BroadcastKind = 'channel' | 'here';

export type DeltaLike = {
  ops?: Array<{
    insert?: unknown;
    attributes?: {
      slackmention?: { id?: string; label?: string; unverified?: boolean };
      code?: boolean;
      'code-block'?: unknown;
    };
  }>;
};

const CHANNEL_ID = /^[CG][A-Z0-9]+$/;
const TEAM_ID = /^[TE][A-Z0-9]+$/;
const USER_ID = /^U[A-Z0-9]+$/;
const TEXT_MENTION = /<!(channel|here)(?:\|[^>]*)?>|(^|[^\w])@(channel|here)\b/gim;
const TYPED_MENTION = /(^|[^\p{L}\p{N}_])@(channel|here)\b/giu;

export const isChannelId = (value: unknown): value is string => CHANNEL_ID.test(String(value || ''));
export const isTeamId = (value: unknown): value is string => TEAM_ID.test(String(value || ''));
export const isUserId = (value: unknown): value is string => USER_ID.test(String(value || ''));

export function textBroadcastKinds(value: unknown, out = new Set<BroadcastKind>()): Set<BroadcastKind> {
  TEXT_MENTION.lastIndex = 0;
  for (const match of String(value || '').matchAll(TEXT_MENTION)) {
    const kind = match[1] || match[3];
    if (kind === 'channel' || kind === 'here') out.add(kind);
  }
  return out;
}

export function broadcastKinds(value: unknown, out = new Set<BroadcastKind>()): Set<BroadcastKind> {
  if (Array.isArray(value)) {
    for (const item of value) broadcastKinds(item, out);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  const node = value as { type?: unknown; range?: unknown; text?: unknown };
  if (node.type === 'broadcast' && (node.range === 'channel' || node.range === 'here')) out.add(node.range);
  if (node.type === 'mrkdwn' && typeof node.text === 'string') textBroadcastKinds(node.text, out);
  for (const nested of Object.values(value)) broadcastKinds(nested, out);
  return out;
}

export function deltaBroadcastKinds(delta: DeltaLike | undefined): Set<BroadcastKind> {
  const kinds = new Set<BroadcastKind>();
  for (const op of delta?.ops ?? []) {
    const id = op?.attributes?.slackmention?.id;
    if (id === 'BKchannel') kinds.add('channel');
    if (id === 'BKhere') kinds.add('here');
  }
  return kinds;
}

export function deltaCandidateKinds(delta: DeltaLike | undefined): Set<BroadcastKind> {
  const kinds = deltaBroadcastKinds(delta);
  let searchable = '';
  for (const op of delta?.ops ?? []) {
    if (typeof op?.insert !== 'string') continue;
    const mention = op.attributes?.slackmention;
    if (mention) {
      const keyword = mention.id === 'BKchannel' || mention.id === 'BKhere' || mention.id === 'UNVERIFIED';
      searchable += keyword ? op.insert : ' ';
      continue;
    }
    searchable += op.attributes?.code === true || op.attributes?.['code-block'] ? ' ' : op.insert;
  }
  return textBroadcastKinds(searchable, kinds);
}

export function plainTextFromDelta(delta: DeltaLike | undefined): string {
  return (delta?.ops ?? [])
    .map((op) => {
      if (typeof op.insert === 'string') return op.insert;
      const label = op.attributes?.slackmention?.label;
      return typeof label === 'string' ? label : '';
    })
    .join('')
    .replace(/\n$/, '');
}

function composerMentionMatches(text: string): Array<{ start: number; end: number; kind: BroadcastKind }> {
  const matches: Array<{ start: number; end: number; kind: BroadcastKind }> = [];
  TYPED_MENTION.lastIndex = 0;
  for (const match of text.matchAll(TYPED_MENTION)) {
    const start = match.index + match[1].length;
    const raw = match[2].toLowerCase();
    const kind: BroadcastKind | undefined = raw === 'channel' || raw === 'here' ? raw : undefined;
    if (!kind) continue;
    matches.push({ start, end: start + match[0].length - match[1].length, kind });
  }
  return matches;
}

/** Turn typed `@channel` / `@here` in rich text into real broadcast nodes. */
export function normalizeRestrictedBroadcasts(
  value: unknown,
  inCode = false,
  found = new Set<BroadcastKind>(),
): unknown {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const normalized = normalizeRestrictedBroadcasts(item, inCode, found);
      return Array.isArray(normalized) ? normalized : [normalized];
    });
  }
  if (!value || typeof value !== 'object') return value;

  const node = value as { type?: unknown; text?: unknown; style?: { code?: boolean } };
  const code = inCode || node.type === 'rich_text_preformatted' || node.style?.code === true;
  if (!code && node.type === 'text' && typeof node.text === 'string') {
    const matches = composerMentionMatches(node.text);
    if (matches.length) {
      const pieces: unknown[] = [];
      let cursor = 0;
      for (const match of matches) {
        if (match.start > cursor) pieces.push({ ...node, text: node.text.slice(cursor, match.start) });
        pieces.push({ type: 'broadcast', range: match.kind });
        found.add(match.kind);
        cursor = match.end;
      }
      if (cursor < node.text.length) pieces.push({ ...node, text: node.text.slice(cursor) });
      return pieces;
    }
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    normalized[key] = normalizeRestrictedBroadcasts(nested, code, found);
  }
  return normalized;
}

export function notificationTextFromBlocks(blocks: unknown[], fallback: string): string {
  const neutralize = (value: string) =>
    value
      .replace(/<!(channel|here)(?:\|[^>]*)?>/gi, (_match, kind: string) => `@\u200b${kind.toLowerCase()}`)
      .replace(/@(channel|here)\b/gi, (_match, kind: string) => `@\u200b${kind.toLowerCase()}`);

  const render = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(render).join('');
    if (!value || typeof value !== 'object') return '';
    const node = value as Record<string, unknown>;
    if (node.type === 'broadcast' && (node.range === 'channel' || node.range === 'here')) return `@${node.range}`;
    if (node.type === 'text' && typeof node.text === 'string') return neutralize(node.text);
    if (node.type === 'user' && typeof node.user_id === 'string') return `<@${node.user_id}>`;
    if (node.type === 'channel' && typeof node.channel_id === 'string') return `<#${node.channel_id}>`;
    if (node.type === 'emoji' && typeof node.name === 'string') return `:${node.name}:`;
    if (node.type === 'link' && typeof node.url === 'string') {
      return typeof node.text === 'string' && node.text !== node.url ? `<${node.url}|${node.text}>` : `<${node.url}>`;
    }
    if (node.type === 'mrkdwn' && typeof node.text === 'string') return neutralize(node.text);
    if (node.type === 'rich_text_list' && Array.isArray(node.elements)) return node.elements.map(render).join('\n');
    if (Array.isArray(node.elements)) return node.elements.map(render).join(node.type === 'rich_text' ? '\n' : '');
    return '';
  };

  const structural = blocks
    .map(render)
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return (structural || neutralize(fallback)).slice(0, 40_000);
}

export function commandOps(commandText: string): Array<{ insert: string }> {
  return [{ insert: `/bchannel ${commandText}\n` }];
}

export function originOf(configured: unknown, fallback = 'https://bc.deployor.dev'): string {
  try {
    const url = new URL(String(configured || fallback).trim());
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
      return url.origin;
    }
  } catch {}
  return fallback;
}
