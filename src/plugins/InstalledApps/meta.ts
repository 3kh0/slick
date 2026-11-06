import type { PluginCategory, SettingsSchema } from '$slick';

export const id = 'InstalledApps';
export const pluginName = 'Installed Apps';
export const description = 'Show apps people authorized, who authorized an app, and its channel memberships.';
export const category: PluginCategory = 'app';
export const defaultEnabled = false;
export const settings = {} as const satisfies SettingsSchema;
