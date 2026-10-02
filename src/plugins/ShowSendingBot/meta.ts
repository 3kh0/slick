import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'ShowSendingBot';
export const pluginName = 'Show Sending Bot';
export const description = 'Show which bot or app sent a message';
export const defaultEnabled = true;

export const settings = {
  hideMcpFooter: {
    type: 'boolean',
    label: 'Hide MCP sender footer',
    description: 'Hide the “Sent using” footer when the app sender is shown as an avatar badge',
    default: false,
  },
} as const satisfies SettingsSchema;
