// Rejoining a huddle after a page reload. The call can't survive
// a reload (audio lives in the page), so on `pagehide` we note which huddle you
// were in and, on the next load, join it again if it's still going.
// sessionStorage is per tab: a reload keeps the note, closing the tab drops it.

import type { CallState } from './huddleCall.ts';

const RESUME_KEY = 'slick-better-huddles:huddle-resume';
/** Only a quick reload counts; coming back much later shouldn't drop you into a call. */
export const RESUME_WINDOW_MS = 2 * 60 * 1000;

export interface HuddleResume {
  channelId: string;
  roomId: string;
  savedAt: number;
}

type ResumeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Notes the huddle you're in (if any) so the next page load can rejoin it. */
export function saveHuddleForReload(call: CallState, storage: ResumeStorage, now = Date.now()): void {
  if (call.status !== 'connected' || !call.roomId) return;
  const resume: HuddleResume = { channelId: call.channelId, roomId: call.roomId, savedAt: now };
  try {
    storage.setItem(RESUME_KEY, JSON.stringify(resume));
  } catch (error) {
    // Storage can be full or blocked; the only cost is not rejoining after this reload.
    console.warn(
      `[slick] [Better Huddles] couldn't remember the huddle for after the reload: ${(error as Error).message}`,
    );
  }
}

/**
 * Reads and clears the note left by `saveHuddleForReload`.
 *
 * Returns:
 *   The huddle to rejoin, or null when there's none, it's malformed, or it's older than RESUME_WINDOW_MS.
 */
export function takeHuddleToResume(storage: ResumeStorage, now = Date.now()): HuddleResume | null {
  let raw: string | null;
  try {
    raw = storage.getItem(RESUME_KEY);
    storage.removeItem(RESUME_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<HuddleResume>;
    const valid =
      typeof parsed.channelId === 'string' &&
      typeof parsed.roomId === 'string' &&
      typeof parsed.savedAt === 'number' &&
      now - parsed.savedAt >= 0 &&
      now - parsed.savedAt <= RESUME_WINDOW_MS;
    return valid
      ? { channelId: parsed.channelId!, roomId: parsed.roomId!, savedAt: parsed.savedAt! }
      : null;
  } catch {
    return null;
  }
}

/** Whether a `screenhero.rooms.info` room is over. */
export function roomHasEnded(room: unknown): boolean {
  if (!room || typeof room !== 'object') return true;
  const { has_ended: hasEnded, date_end: dateEnd } = room as { has_ended?: unknown; date_end?: unknown };
  return hasEnded === true || (typeof dateEnd === 'number' && dateEnd > 0);
}

export interface ResumeDeps {
  storage: ResumeStorage;
  /** `screenhero.rooms.info`'s `room` for a room id. */
  roomInfo: (roomId: string) => Promise<unknown>;
  join: (channelId: string, options: { muted: boolean }) => Promise<void>;
}

/**
 * After a reload, rejoins the huddle you were in if it's still going. An ended
 * huddle isn't restarted: that would ring the whole channel.
 *
 * Returns:
 *   What happened: 'none' (nothing to resume), 'ended', 'rejoined', or 'failed' (couldn't check).
 */
export async function resumeHuddleAfterReload({ storage, roomInfo, join }: ResumeDeps) {
  const resume = takeHuddleToResume(storage);
  if (!resume) return 'none' as const;
  try {
    if (roomHasEnded(await roomInfo(resume.roomId))) return 'ended' as const;
  } catch (error) {
    console.warn(
      `[slick] [Better Huddles] couldn't check the huddle to rejoin after the reload: ${(error as Error).message}`,
    );
    return 'failed' as const;
  }
  // Always muted: nobody clicked Join this time, so the mic mustn't go live on its own.
  // join() reports its own failures in the call window.
  await join(resume.channelId, { muted: true });
  return 'rejoined' as const;
}
