import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'NeutralPronouns';
export const pluginName = 'Neutral Pronouns';
export const description = 'Rewrites he/she pronouns in messages you send to they/them, adjusting nearby verbs.';
export const category: PluginCategory = 'composer';
export const authors = 'JosTheDude';
export const defaultEnabled = false;
export const settings = {} as const satisfies SettingsSchema;
