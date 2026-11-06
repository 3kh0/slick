import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'LetMeSee';
export const pluginName = 'Let Me See';
export const description = 'Adds a Hide drawings button to the floating huddle bar shown during a screenshare';
export const category: PluginCategory = 'sounds';
export const defaultEnabled = true;

export const settings = {} as const satisfies SettingsSchema;
