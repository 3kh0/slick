import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'DeArrow';
export const pluginName = 'DeArrow';
export const description =
  'Replace clickbait YouTube titles and thumbnails with crowdsourced ones. Sends the IDs of YouTube videos you see to DeArrow (sponsor.ajay.app).';
export const category: PluginCategory = 'messages';
export const defaultEnabled = false;

export const settings = {
  replace: {
    type: 'select',
    label: 'Replace',
    default: 'all',
    options: [
      { value: 'all', label: 'Titles and thumbnails' },
      { value: 'titles', label: 'Titles only' },
      { value: 'thumbnails', label: 'Thumbnails only' },
    ],
  },
  dearrowByDefault: {
    type: 'boolean',
    label: 'DeArrow videos automatically',
    description: 'When off, videos keep their original title and thumbnail until you click the DeArrow button.',
    default: true,
  },
  showButton: {
    type: 'boolean',
    label: 'Show the DeArrow button',
    description: 'A button beside the title switches between the original and DeArrow’s version.',
    default: true,
  },
  wrapTitles: {
    type: 'boolean',
    label: 'Wrap long titles',
    description: 'Show the whole title of a YouTube video over several lines instead of cutting it off.',
    default: false,
  },
} as const satisfies SettingsSchema;
