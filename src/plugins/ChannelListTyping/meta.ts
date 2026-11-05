import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'ChannelListTyping';
export const pluginName = 'Channel List Typing';
export const description = 'Show who’s typing next to each channel and DM in the sidebar';
export const category: PluginCategory = 'channels';
export const defaultEnabled = false;

export const settings = {
  display: {
    type: 'select',
    label: 'Show',
    default: 'both',
    options: [
      { value: 'both', label: 'Profile pictures and dots' },
      { value: 'dots', label: 'Dots' },
      { value: 'avatars', label: 'Profile pictures' },
    ],
  },
  includeCurrentChannel: {
    type: 'boolean',
    label: 'Include the open channel',
    default: true,
  },
  includeMutedChannels: {
    type: 'boolean',
    label: 'Include muted channels',
    default: false,
  },
  includeThreads: {
    type: 'boolean',
    label: 'Include thread replies',
    description: 'Count people typing in a channel’s threads as typing in the channel',
    default: true,
  },
} as const satisfies SettingsSchema;
