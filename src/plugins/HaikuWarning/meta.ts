import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'HaikuWarning';
export const pluginName = 'Haiku Warning';
export const description = 'Warn before sending a message that Orpheus would quote back as a haiku';
export const defaultEnabled = false;

export const settings = {} as const satisfies SettingsSchema;
