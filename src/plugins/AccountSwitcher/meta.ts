import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'AccountSwitcher';
export const pluginName = 'Account Switcher';
export const description = 'Switch between saved accounts from the profile menu';
export const category: PluginCategory = 'app';
export const defaultEnabled = false;

export const settings = {} as const satisfies SettingsSchema;
