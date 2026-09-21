import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'AnonymiseFileNames';
export const pluginName = 'Anonymise File Names';
export const description = 'Replace uploaded file names with a random string, keeping the extension';
export const defaultEnabled = false;

export const settings = {
  keepExtension: {
    type: 'boolean',
    label: 'Keep the file extension',
    description: 'Leave the extension intact so Slack still previews the file correctly',
    default: true,
  },
} as const satisfies SettingsSchema;
