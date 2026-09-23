import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'Nicknames';
export const pluginName = 'Nicknames';
export const description = 'Set local nicknames for users';
export const defaultEnabled = true;

export const settings = {
  names: {
    type: 'names',
    label: 'Nicknames',
    description: 'Local nicknames, by user ID. Set these from a profile menu.',
    default: {},
  },
} as const satisfies SettingsSchema;
