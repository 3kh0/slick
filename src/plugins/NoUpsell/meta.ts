import type { PluginCategory, SettingsSchema } from '$slick';

export const id = 'NoUpsell';
export const pluginName = 'NoUpsell';
export const description = 'Hide promotions, trial offers, and Slack bot AI nudges.';
export const category: PluginCategory = 'app';
export const defaultEnabled = false;

export const settings = {
  paidPlans: { type: 'boolean', label: 'Hide things to make you pay for Slack', default: true },
  slackbotAI: { type: 'boolean', label: 'Hide Slack bot AI promotions and shortcuts', default: true },
} as const satisfies SettingsSchema;
