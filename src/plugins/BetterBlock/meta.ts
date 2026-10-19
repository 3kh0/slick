import type { SettingsSchema } from '$slick';

export const id = 'BetterBlock';
export const pluginName = 'BetterBlock';
export const description =
  'Make people disappear locally: messages, reactions, typing, and more. Huddles are untouched.';
export const defaultEnabled = false;

export const settings = {
  blockedUsers: {
    type: 'names',
    label: 'Blocked people',
    description:
      'Add people from their profile’s More menu. Remove a person here to unblock them. Messages are hidden locally; blocked DMs are marked read in Slack.',
    default: {},
  },
  includeHiddenUsers: {
    type: 'boolean',
    label: 'Also block people hidden in Slack',
    description:
      'Apply BetterBlock to Slack’s existing hidden-person list. Manage those people in Slack’s privacy settings.',
    default: true,
  },
} as const satisfies SettingsSchema;
