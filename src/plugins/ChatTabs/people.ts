export function chatMemberIds(channel: any, selfId?: string): string[] {
  if (channel?.is_im) return typeof channel.user === 'string' ? [channel.user] : [];
  if (!channel?.is_mpim || !Array.isArray(channel.members)) return [];
  const members = [
    ...new Set<string>(
      channel.members.filter((id: unknown): id is string => typeof id === 'string' && /^[UW][A-Z0-9]+$/.test(id)),
    ),
  ];
  const others = members.filter((id) => id !== selfId);
  return others.length ? others : members;
}

export function memberName(member: any, fallback: string): string {
  return member?.profile?.display_name || member?.profile?.real_name || member?.real_name || member?.name || fallback;
}

export function chatLabel(state: any, channelId: string, selfId?: string): string {
  const channel = state?.channels?.[channelId];
  if (!channel) return channelId;
  if (channel.is_im) return memberName(state.members?.[channel.user], channelId);
  if (channel.is_mpim) {
    const names = chatMemberIds(channel, selfId).map((id) => memberName(state.members?.[id], id));
    return names.toSorted((a, b) => a.localeCompare(b)).join(', ') || 'Group DM';
  }
  return channel.name || channelId;
}
