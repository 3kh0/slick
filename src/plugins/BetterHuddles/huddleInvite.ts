import type { CallState } from './huddleCall.ts';

export interface InviteMember {
  id: string;
  name: string;
  realName?: string;
  avatarUrl?: string;
  inChannel?: boolean;
}

export function inviteSearchResults(value: unknown): InviteMember[] {
  if (!Array.isArray(value)) return [];
  const members = new Map<string, InviteMember>();
  for (const result of value) {
    const member = result?.item;
    if (result?.type !== 'member' || !member || !/^[UW][A-Z0-9]+$/.test(member.id)) continue;
    if (member.deleted || member.is_bot || member.is_app_user) continue;
    const name = member.profile?.display_name || member.profile?.real_name || member.real_name || member.name;
    if (typeof name !== 'string' || !name.trim()) continue;
    const rawImage = member.profile?.image_48 || member.profile?.image_72 || member.profile?.image_24;
    const avatarUrl = typeof rawImage === 'string' && rawImage.startsWith('https://') ? rawImage : undefined;
    const realName = member.profile?.real_name || member.real_name;
    members.set(member.id, {
      id: member.id,
      name,
      ...(typeof realName === 'string' && realName !== name ? { realName } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    });
  }
  return [...members.values()];
}

export async function inviteHuddleMember({
  getCall,
  roomId,
  userId,
  notify,
}: {
  getCall: () => CallState;
  roomId: string;
  userId: string;
  notify: (args: { channelId: string; userId: string; reason: string }) => Promise<unknown>;
}): Promise<void> {
  const call = getCall();
  if (call.status !== 'connected' || !roomId || call.roomId !== roomId) throw new Error('This huddle has ended.');
  if (!/^[UW][A-Z0-9]+$/.test(userId)) throw new Error('Choose a person to invite.');
  if (userId === call.localUserId || call.participants.includes(userId))
    throw new Error('This person is already in the huddle.');
  await notify({ channelId: call.channelId, userId, reason: 'huddle-notify-member' });
}

export async function completeInviteSearch(value: unknown): Promise<InviteMember[]> {
  if (!Array.isArray(value)) return [];
  const pending = (value as unknown[] & { promise?: Promise<unknown> }).promise;
  const complete = pending ? await pending : [];
  return inviteSearchResults([...value, ...(Array.isArray(complete) ? complete : [])]);
}
