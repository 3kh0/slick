// Recognizing Slack's notification sound assets.
//
// Slack serves them from slack-edge.com under a fixed set of names, with a
// content hash appended. Matching on the name rather than the full URL means a
// Slack redeploy does not silently stop the plugin working.

/** Slack's notification sound names, as of 4.52.155. */
export const SOUND_NAMES = new Set([
  'animal_stick',
  'b2',
  'been_tree',
  'boop',
  'channel_message',
  'channel_message_2x',
  'complete_quest_requirement',
  'confirm_delivery',
  'flitterbug',
  'here_you_go_lighter',
  'hi_flowers_hit',
  'hummus',
  'item_pickup',
  'knock_brush',
  'save_and_checkout',
]);

/** `boop-1a2b3c4d.mp3` -> `boop`. The hash is optional. */
const ASSET = /^([a-z0-9_]+?)(?:-[0-9a-f]{6,32})?\.(?:aac|m4a|mp3|oga|ogg|opus|wav)$/i;

/**
 * Whether a media source is one of Slack's own notification sounds. Restricted
 * to Slack's origins so a message containing an audio file called `boop.mp3`
 * does not get replaced.
 */
export function isNotificationSound(src: string, base: string): boolean {
  let url: URL;
  try {
    url = new URL(src, base);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;

  const origin = new URL(base).origin;
  if (!/(^|\.)slack-edge\.com$/i.test(url.hostname) && url.origin !== origin) return false;

  const file = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  const name = ASSET.exec(file)?.[1];
  return !!name && SOUND_NAMES.has(name.toLowerCase());
}

/** The URL the main half serves a chosen file from. */
export function customSoundUrl(path: string): string {
  const extension = /\.[a-z0-9]{1,8}$/i.exec(path)?.[0] ?? '.mp3';
  return `slick-custom-sounds://current/sound${extension}?p=${encodeURIComponent(path)}`;
}
