// Keep Slack's preview and confirmation flow; replace only the confirmed join.
export const TAKEN_OVER_THUNKS = ['startHuddle'] as const;

export interface TakeOverRequest {
  channelId: string;
  muted: boolean;
}

// Channels, private channels, DMs and group DMs.
const CONVERSATION_ID = /^[CDG][A-Z0-9]{2,}$/;

/**
 * The huddle to join instead of Slack's, or null to let Slack handle it:
 * standalone huddles (links without a conversation) have no channel to
 * rooms.join, so those stay with Slack.
 */
export function takeOverRequest(args: unknown): TakeOverRequest | null {
  if (!args || typeof args !== 'object') return null;
  const { channelId, muted, isStandaloneHuddle } = args as {
    channelId?: unknown;
    muted?: unknown;
    isStandaloneHuddle?: unknown;
  };
  if (isStandaloneHuddle === true) return null;
  if (typeof channelId !== 'string' || !CONVERSATION_ID.test(channelId)) return null;
  return { channelId, muted: muted === true };
}

/**
 * Closes windows Slack opened ahead of the dispatch (some entry points open the
 * huddle / preview window synchronously, to dodge popup blockers, and pass it
 * along as a WeakRef in `windowRef` or `previewWindowRef`).
 */
export function closePreparedWindows(args: unknown): void {
  if (!args || typeof args !== 'object') return;
  for (const key of ['windowRef', 'previewWindowRef'] as const) {
    const ref = (args as Record<string, unknown>)[key] as { deref?: () => unknown } | undefined;
    const prepared = typeof ref?.deref === 'function' ? (ref.deref() as { close?: () => void } | undefined) : undefined;
    try {
      prepared?.close?.();
    } catch (error) {
      console.warn(`[slick] [Better Huddles] could not close Slack's ${key} window:`, error);
    }
  }
}
