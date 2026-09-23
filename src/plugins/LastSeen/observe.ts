// Which RTM events imply someone was at their keyboard, and who. Inferred only
// from traffic this client receives anyway, hence "observed".

import type { RtmEvent } from '$slick';

/** The id, unless a bot posted under it with a user token. */
const human = (event: RtmEvent | undefined, id: unknown): string | undefined =>
  event && typeof id === 'string' && !event.bot_id && !event.app_id ? id : undefined;

export const ACTIVITY: Record<string, (event: RtmEvent) => string | string[] | undefined> = {
  // `away` arrives in bulk on subscribe; counting it would stamp the whole
  // workspace as seen now.
  presence_change: (event) => (event.presence === 'active' ? (event.users ?? event.user) : undefined),
  user_typing: (event) => event.user,
  message: (event) =>
    human(event, event.user) ??
    // A reply carries the parent's own `edited.user`, from whenever that was.
    (event.subtype === 'message_changed' ? human(event.message, event.message?.edited?.user) : undefined),
  reaction_added: (event) => event.user,
  reaction_removed: (event) => event.user,
  pin_added: (event) => event.user,
  pin_removed: (event) => event.user,
  file_shared: (event) => event.user_id,
  sh_room_join: (event) => event.user,
};

/** Slack ts decimals end in a uniqueness counter, so round to whole ms. */
export function when(event: RtmEvent): number {
  const at = Number.parseFloat(event.event_ts ?? event.ts);
  return at > 0 ? Math.round(at * 1000) : Date.now();
}

const UNITS = [
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
] as const;

export function ago(at: number, now = Date.now()): string {
  const elapsed = now - at;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) return format.format(-Math.max(1, Math.floor(elapsed / size)), unit);
  }
  return 'just now';
}

/** Drop entries older than `ttlMs`, then the oldest past `max`. */
export function prune(seen: Map<string, number>, max: number, ttlMs: number, now = Date.now()): Map<string, number> {
  for (const [id, at] of seen) if (now - at > ttlMs) seen.delete(id);
  if (seen.size <= max) return seen;

  const keep = [...seen].toSorted((a, b) => b[1] - a[1]).slice(0, max);
  return new Map(keep);
}
