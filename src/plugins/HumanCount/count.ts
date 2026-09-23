export type MembershipCounts = {
  member_count?: number;
  restricted_member_count?: number | null;
  app_count?: number | null;
};

export function humanCount(counts: MembershipCounts | undefined, excludeGuests = false): number | undefined {
  const people = counts?.member_count;
  if (typeof people !== 'number' || !Number.isFinite(people)) return undefined;
  const guests = excludeGuests ? Number(counts?.restricted_member_count) || 0 : 0;
  return Math.max(0, people - guests);
}
