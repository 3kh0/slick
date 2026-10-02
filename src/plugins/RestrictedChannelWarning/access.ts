type Restriction = { type?: string[]; user?: string[] };
export type RestrictedChannel = {
  properties?: { posting_restricted_to?: Restriction; threads_restricted_to?: Restriction };
};
export type ChannelAccess = { readOnly: boolean; threadOnly: boolean };

/** An override expires when either the channel policy or the account changes. */
export function restrictionKey(channel: RestrictedChannel | undefined, userId: string): string {
  return JSON.stringify([
    userId,
    channel?.properties?.posting_restricted_to,
    channel?.properties?.threads_restricted_to,
  ]);
}

/** Only add a roadblock when Slack permits posting because of an admin exemption. */
export function restrictedAccess(
  channel: RestrictedChannel | undefined,
  userId: string | undefined,
  current: ChannelAccess,
  ignoredKey?: string,
): ChannelAccess | null {
  if (!channel?.properties || !userId || ignoredKey === restrictionKey(channel, userId)) return null;
  const adminOnly = (rule: Restriction | undefined) =>
    !!rule?.type?.length &&
    rule.type.every((type) => type === 'admin' || type === 'org_admin') &&
    !rule.user?.includes(userId);
  const { posting_restricted_to: posting, threads_restricted_to: threads } = channel.properties;
  const canPost = !current.readOnly && !current.threadOnly && !adminOnly(posting);
  const canReply = !current.readOnly && !adminOnly(threads);
  const next = { readOnly: !canPost && !canReply, threadOnly: !canPost && canReply };
  return next.readOnly === current.readOnly && next.threadOnly === current.threadOnly ? null : next;
}
