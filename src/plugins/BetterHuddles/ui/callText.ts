import type { SlackChannel, SlackMember } from '$slick';

/** "3 min", "1 h 5 min": how long you've been in the huddle. */
export function formatHuddleDuration(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

export function memberDisplayName(member: SlackMember | undefined, fallback = 'Someone'): string {
  const profile = member?.profile;
  return profile?.display_name || profile?.real_name || member?.real_name || member?.name || fallback;
}

export function memberPronouns(member: SlackMember | undefined): string {
  const pronouns = member?.profile?.pronouns;
  return typeof pronouns === 'string' ? pronouns : '';
}

// Photos come from Slack's data; only plain https URLs reach an <img>.
function safeImageUrl(url: unknown): string {
  if (typeof url !== 'string') return '';
  try {
    return new URL(url).protocol === 'https:' ? url : '';
  } catch {
    return '';
  }
}

/** The biggest profile photo Slack has for someone (tiles can be large). */
export function memberPhotoUrl(member: SlackMember | undefined): string {
  const profile = member?.profile;
  return (
    safeImageUrl(profile?.image_original) ||
    safeImageUrl(profile?.image_1024) ||
    safeImageUrl(profile?.image_512) ||
    safeImageUrl(profile?.image_192)
  );
}

/** "#general", a DM partner's name, or "Huddle" when the conversation isn't loaded. */
export function conversationLabel(
  channel: SlackChannel | undefined,
  dmPartnerName: (userId: string) => string | undefined,
): string {
  if (!channel) return 'Huddle';
  const partner = typeof channel.user === 'string' ? channel.user : undefined;
  if (channel.is_im && partner) return dmPartnerName(partner) ?? 'Direct message';
  // Group DMs are named like "mpdm-ada--grace-1", which isn't worth showing.
  if (channel.is_mpim) return 'Group message';
  return channel.name ? `#${channel.name}` : 'Huddle';
}

export function peopleCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'person' : 'people'}`;
}

/** Stable hue per seed, so each person keeps "their" colour. */
export function avatarHue(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return hash % 360;
}

/** The first two letters, upper-cased, shown when someone has no usable photo. */
export function avatarInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}
