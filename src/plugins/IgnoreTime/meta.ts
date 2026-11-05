import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'IgnoreTime';
export const pluginName = 'Ignore Time';
export const description = 'Makes Slack not copy that stupid little timestamp';
export const defaultEnabled = true;

export const settings = {} as const satisfies SettingsSchema;
