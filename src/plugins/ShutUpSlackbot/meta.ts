import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'ShutUpSlackbot';
export const pluginName = 'Shut Up Slackbot';
export const description = 'Mark Slackbot slash-command registration DMs as read and silence their notifications.';
export const category: PluginCategory = 'app';
export const defaultEnabled = false;

export const settings = {} as const satisfies SettingsSchema;
