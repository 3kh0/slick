import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'BetterGifs';
export const pluginName = 'Better GIFs';
export const description = 'Enhances Slack’s GIF picker with a better search experience, favorites, and more.';
export const defaultEnabled = false;

export const settings = {
  defaultView: {
    type: 'select',
    label: 'Open GIF picker to',
    description: 'Choose the initial tab each time you open the GIF picker.',
    default: 'search',
    options: [
      { value: 'search', label: 'Search / top GIFs' },
      { value: 'favorites', label: 'Favorites' },
    ],
  },
  provider: {
    type: 'select',
    label: 'GIF provider',
    description: 'Tenor is the default. Giphy is Slack’s own picker. KLIPY needs your own API key (see below).',
    default: 'tenor',
    options: [
      { value: 'tenor', label: 'Tenor Proxy' },
      { value: 'giphy', label: 'Giphy (Slack default)' },
      { value: 'klipy', label: 'KLIPY (needs API key)' },
    ],
  },
  klipyApiKey: {
    type: 'text',
    label: 'KLIPY API key',
    description:
      'Free: sign in at partner.klipy.com, add a platform, create a key, paste it here. Only used when the provider is KLIPY.',
    default: '',
    maxLength: 128,
  },
} as const satisfies SettingsSchema;
