import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'bChannel';
export const pluginName = 'bChannel';
export const description = 'Type @channel or @here and send, no permission hassles, even as a channel manager';
export const defaultEnabled = false;

export const settings = {
  serviceUrl: {
    type: 'text',
    label: 'bChannel service URL',
    description: 'The trusted bChannel server configured for this workspace.',
    default: 'https://bc.deployor.dev',
  },
} as const satisfies SettingsSchema;
