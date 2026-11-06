import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'Nicknames';
export const pluginName = 'Nicknames';
export const description = 'Set local nicknames for users and apps';
export const category: PluginCategory = 'people';
export const defaultEnabled = true;

export const settings = {
  names: {
    type: 'names',
    label: 'Nicknames',
    description: 'Local nicknames, by user or app ID. Set these from a profile or app menu.',
    default: {},
  },
} as const satisfies SettingsSchema;
