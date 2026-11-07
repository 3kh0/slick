import type { CallState } from './huddleCall.ts';

type ThreadTarget = { channelId: string; threadTs: string };
type ThreadCall = Pick<CallState, 'status' | 'channelId' | 'roomId'>;

function threadTarget(value: unknown, fallbackChannel: string): ThreadTarget | null {
  if (!value || typeof value !== 'object') return null;
  const thread = value as Record<string, unknown>;
  const ts = thread.ts ?? thread.canvas_thread_ts;
  const channelId = thread.channelId ?? (Array.isArray(thread.channels) ? thread.channels[0] : fallbackChannel);
  if (typeof ts !== 'string' || !/^[1-9]\d*\.\d+$/.test(ts)) return null;
  if (typeof channelId !== 'string' || !/^[CDG][A-Z0-9]+$/.test(channelId)) return null;
  return { channelId, threadTs: ts };
}

export async function openHuddleThread({
  getCall,
  getCachedThread,
  getRoom,
  showThread,
  focusSlack,
}: {
  getCall: () => ThreadCall;
  getCachedThread: (roomId: string) => unknown;
  getRoom: (roomId: string) => Promise<unknown>;
  showThread: (target: ThreadTarget) => Promise<unknown>;
  focusSlack: () => void;
}) {
  const call = getCall();
  if (call.status !== 'connected' || !call.roomId) return;
  const target =
    threadTarget(getCachedThread(call.roomId), call.channelId) ??
    threadTarget(await getRoom(call.roomId), call.channelId);
  const current = getCall();
  if (current.status !== 'connected' || current.roomId !== call.roomId || current.channelId !== call.channelId) return;
  if (!target) throw new Error('The huddle thread is not available yet. Try again in a moment.');
  await showThread(target);
  focusSlack();
}
