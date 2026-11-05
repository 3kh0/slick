import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'MentionProfiles';
export const pluginName = 'Mention Profiles';
export const description = 'Show profile pictures inside @mentions';
export const category: PluginCategory = 'messages';
export const defaultEnabled = false;

export const settings = {
  showAtSymbol: {
    type: 'boolean',
    label: 'Show the @ symbol',
    description: 'Keep the @ in front of names in mentions.',
    default: true,
  },
} as const satisfies SettingsSchema;
