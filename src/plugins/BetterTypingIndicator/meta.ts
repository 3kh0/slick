import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'BetterTypingIndicator';
export const pluginName = 'Better Typing Indicator';
export const description =
  'Show as many of the people typing as fit, with their profile pictures, and open their profiles from the indicator';
export const category: PluginCategory = 'people';
export const defaultEnabled = false;

export const settings = {
  showAvatars: {
    type: 'boolean',
    label: 'Show profile pictures',
    description: 'Show each typing person’s profile picture next to their name',
    default: true,
  },
} as const satisfies SettingsSchema;
