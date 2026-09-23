import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'ClearURLs';
export const pluginName = 'Clear URLs';
export const description = 'Automatically removes tracking elements from URLs you send';
export const defaultEnabled = false;

export const settings = {
  extraRules: {
    type: 'text',
    label: 'Extra rules',
    description: 'Comma-separated additional rules: "param" or "param@host" ("*" wildcards allowed)',
    default: '',
  },
} as const satisfies SettingsSchema;
