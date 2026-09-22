import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'Click2Load';
export const pluginName = 'Click to Load';
export const description = 'Replaces third-party media embeds with privacy-preserving click-to-load placeholders';
export const defaultEnabled = false;

const allow = (label: string, hint: string) => ({ type: 'boolean', label, description: hint, default: false }) as const;

export const settings = {
  spotify: allow('Spotify', 'Allow Spotify embeds to load without asking'),
  soundcloud: allow('SoundCloud', 'Allow SoundCloud embeds to load without asking'),
  other: allow(
    'Other message embeds',
    'Allow other third-party frames embedded in Slack messages to load without asking',
  ),
} as const satisfies SettingsSchema;

/** Always gated, wherever they appear. */
export const PROVIDERS = [
  { key: 'spotify', label: 'Spotify', domains: ['spotify.com'] },
  { key: 'soundcloud', label: 'SoundCloud', domains: ['soundcloud.com'] },
] as const;

/** Never gated. */
export const INTERNAL_DOMAINS = ['slack.com', 'slack-edge.com', 'slack-imgs.com', 'slackb.com', 'slack-core.com'];
