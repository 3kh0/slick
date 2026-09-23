import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'CustomSlackbot';
export const pluginName = 'Custom Slackbot';
export const description = 'Customize the name and avatar used for workspace custom responses';
export const defaultEnabled = false;

export const settings = {
  name: {
    type: 'text',
    label: 'Display name',
    description: "Name shown on custom responses. Leave blank to use Slack's default.",
    default: 'Slackbot',
  },
  url: {
    type: 'text',
    label: 'Avatar URL',
    description: "Image shown on custom responses. Leave blank to use Slack's default.",
    default: 'https://ca.slack-edge.com/E09V59WQY1E-USLACKBOT-sv41d8cd98f0-192',
  },
  badge: {
    type: 'boolean',
    label: 'Hide custom response badge',
    description: 'Hide the badge that identifies messages as custom responses',
    default: true,
  },
} as const satisfies SettingsSchema;
