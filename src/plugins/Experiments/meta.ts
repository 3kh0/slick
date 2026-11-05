import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'Experiments';
export const pluginName = 'Experiments';
export const description = 'Enable Access to Experiments & other dev-only features in Slack!';
export const category: PluginCategory = 'app';
export const defaultEnabled = false;

export const settings = {} as const satisfies SettingsSchema;
