// Retention is bounded by age, count and per-entry size: a busy workspace
// produced ~1000 entries/day, and single entries reached 127 KB.

import type { SlackMessage } from '$slick';

export const MAX_ENTRIES = 1000;
export const MAX_EDITS_PER_MESSAGE = 20;
export const MAX_EDIT_TEXT = 4000;
/** Messages are stored whole (to be injected back), so blocks can make them large. */
export const MAX_MESSAGE_BYTES = 32 * 1024;
export const DAY_MS = 24 * 60 * 60 * 1000;

const HEAVY_FIELDS = ['blocks', 'attachments', 'files', 'metadata'] as const;

export function weigh(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Infinity;
  }
}

/**
 * Drop heavy fields until it fits, then truncate `text` (never dropped). A row
 * without blocks still renders: Slack falls back to `text`.
 */
export function trim(message: SlackMessage): SlackMessage {
  if (weigh(message) <= MAX_MESSAGE_BYTES) return message;
  for (const field of HEAVY_FIELDS) {
    if (!(field in message)) continue;
    delete (message as Record<string, unknown>)[field];
    if (weigh(message) <= MAX_MESSAGE_BYTES) return message;
  }
  if (typeof message.text === 'string') {
    const over = weigh(message) - MAX_MESSAGE_BYTES;
    if (over > 0) message.text = `${message.text.slice(0, Math.max(0, message.text.length - over - 1))}…`;
  }
  return message;
}

/** Too old first, then oldest-first until the count fits. `retentionDays` 0 ignores age. */
export function evictable(entries: Iterable<[string, { at?: number }]>, retentionDays: number, now = Date.now()) {
  const live = new Map(entries);
  const out: string[] = [];

  if (retentionDays > 0) {
    const cutoff = now - retentionDays * DAY_MS;
    for (const [key, entry] of live) {
      if ((entry.at ?? 0) >= cutoff) continue;
      out.push(key);
      live.delete(key);
    }
  }

  if (live.size > MAX_ENTRIES) {
    const ordered = [...live].toSorted((a, b) => (a[1].at ?? 0) - (b[1].at ?? 0));
    for (const [key] of ordered) {
      if (live.size <= MAX_ENTRIES) break;
      out.push(key);
      live.delete(key);
    }
  }

  return out;
}

/**
 * Apply current caps to an entry stored under looser ones; caps enforced only
 * on write would leave oversized entries until the message was edited again.
 * Returns whether it changed, so the caller persists it.
 */
export function normalize(entry: { message?: SlackMessage; edits?: { oldText: string; newText: string }[] }): boolean {
  let changed = false;

  if (entry.edits && entry.edits.length > MAX_EDITS_PER_MESSAGE) {
    entry.edits = entry.edits.slice(-MAX_EDITS_PER_MESSAGE);
    changed = true;
  }
  for (const edit of entry.edits ?? []) {
    for (const field of ['oldText', 'newText'] as const) {
      if (typeof edit[field] !== 'string' || edit[field].length <= MAX_EDIT_TEXT) continue;
      edit[field] = edit[field].slice(0, MAX_EDIT_TEXT);
      changed = true;
    }
  }

  if (entry.message && weigh(entry.message) > MAX_MESSAGE_BYTES) {
    entry.message = trim(entry.message);
    changed = true;
  }

  return changed;
}
