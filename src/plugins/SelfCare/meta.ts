import type { PluginCategory, SettingsSchema } from '$slick';

export const id = 'SelfCare';
export const pluginName = 'Self Care';
export const description = 'Take a break from Slack and pause notifications for a while.';
export const category: PluginCategory = 'app';
export const defaultEnabled = false;

export const settings = {
  minutes: {
    type: 'number',
    label: 'Break duration (minutes)',
    default: 30,
    min: 1,
    max: 10080,
  },
  message: {
    type: 'text',
    label: 'Self-care message',
    default: 'Take a breath. Stretch, drink some water, or do something that makes you feel good. Slack can wait.',
    maxLength: 500,
  },
} as const satisfies SettingsSchema;
