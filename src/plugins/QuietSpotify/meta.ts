import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'QuietSpotify';
export const pluginName = 'Quiet Spotify';
export const description = 'Customize the volume of Spotify embeds so they are not stupidly loud';
export const defaultEnabled = false;

export const settings = {
  volume: {
    type: 'number',
    label: 'Volume (%)',
    description: '0-100. Anything above 10% is very loud.',
    default: 10,
    min: 0,
    max: 100,
  },
} as const satisfies SettingsSchema;
