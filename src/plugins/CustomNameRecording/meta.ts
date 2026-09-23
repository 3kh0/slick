import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'CustomNameRecording';
export const pluginName = 'Custom Name Recording';
export const description = 'Upload custom audio as your Slack name recording';
export const defaultEnabled = false;

export const settings = {} as const satisfies SettingsSchema;
