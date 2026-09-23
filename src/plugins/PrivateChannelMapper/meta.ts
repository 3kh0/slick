import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'PrivateChannelMapper';
export const pluginName = 'Private Channel Mapper';
export const description = 'Name the private channels you can’t see, and mention the ones you are not in';
export const defaultEnabled = false;

export const settings = {
  flaron: {
    type: 'boolean',
    label: 'Use external private channel DB (Flaron)',
    description: 'If enabled, the plugin will show known private channel names if no local name is found.',
    default: false,
  },
  mentions: {
    type: 'boolean',
    label: 'Mention private channels you are not in',
    description:
      'Autocompletes #channel in the composer for private channels Slack hides from you. Sends the exact name you typed to Flaron to look the channel ID up.',
    default: false,
  },
} as const satisfies SettingsSchema;
