import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'OnlineCount';
export const pluginName = 'Online Count';
export const description = "Show how many of a channel's members are online, next to its member count";
export const defaultEnabled = false;

export const settings = {
  estimate: {
    type: 'boolean',
    label: 'Estimate big channels',
    description:
      'Slack can only follow about 1,000 people’s presence at once, so channels over 500 people get an estimate from a sample of 2,000.',
    default: true,
  },
} as const satisfies SettingsSchema;
