import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'UserPronouns';
export const pluginName = 'User Pronouns';
export const description = "Display users' pronouns next to their messages";
export const defaultEnabled = true;

export const settings = {} as const satisfies SettingsSchema;
