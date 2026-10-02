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
    description:
      'Tenor is byfar the best GIF provider, but Giphy is the default for Slack. You can switch to Giphy if you prefer it.',
    default: 'tenor',
    options: [
      { value: 'tenor', label: 'Tenor Proxy' },
      { value: 'giphy', label: 'Giphy (Slack default)' },
    ],
  },
} as const satisfies SettingsSchema;
