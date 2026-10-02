import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'RestrictedChannelWarning';
export const pluginName = 'Restricted Channel Warning';
export const description = 'Warn before posting in channels where only admins can post';
export const defaultEnabled = false;
export const settings = {} as const satisfies SettingsSchema;
