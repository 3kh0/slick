import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'WhoReacted';
export const pluginName = 'Who Reacted';
export const description = 'Show the avatars of everyone who reacted next to each reaction';
export const defaultEnabled = false;

export const settings = {
  maxAvatars: {
    type: 'number',
    label: 'Max avatars',
    description: 'How many avatars to show before the rest collapse into a +N',
    default: 8,
    min: 1,
    max: 20,
  },
} as const satisfies SettingsSchema;
