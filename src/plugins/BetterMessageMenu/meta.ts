import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'BetterMessageMenu';
export const pluginName = 'Better Message Menu';
export const description = 'excuse me laddie but i organized your menu';
export const defaultEnabled = false;
export const category: PluginCategory = 'messages';

// No schema settings: the whole menu is configured from the plugin's own
// "Better Message Menu" settings tab, not from auto-rendered toggles.
export const settings = {} as const satisfies SettingsSchema;
