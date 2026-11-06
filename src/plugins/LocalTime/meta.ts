import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'LocalTime';
export const pluginName = 'Local Time';
export const description =
  "Show each person's local time beside their messages and in their profile, even while they're away.";
export const defaultEnabled = false;
export const category: PluginCategory = 'people';

export const settings = {
  showInMessages: {
    type: 'boolean',
    label: 'Show in messages',
    description: "Show the time after the sender's name, next to their pronouns.",
    default: true,
  },
  showOnProfiles: {
    type: 'boolean',
    label: 'Show on profiles',
    description: 'Show the time in profile pop-ups and hover cards, including when someone is out of office.',
    default: true,
  },
  use12Hour: {
    type: 'boolean',
    label: '12-hour clock',
    default: true,
  },
} as const satisfies SettingsSchema;
