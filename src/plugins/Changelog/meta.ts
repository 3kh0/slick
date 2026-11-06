import type { PluginCategory, SettingsSchema } from '$slick';

export const id = 'Changelog';
export const pluginName = 'Changelog';
export const description = "Adds a button to the top bar that opens Slick's release notes.";
export const category: PluginCategory = 'app';
export const defaultEnabled = true;

export const settings = {} as const satisfies SettingsSchema;
