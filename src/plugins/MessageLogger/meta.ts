import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'MessageLogger';
export const pluginName = 'Message Logger';
export const description = 'Keep deleted and edited messages visible';
export const defaultEnabled = false;

export const settings = {
  deletedStyle: {
    type: 'select',
    label: 'Deleted style',
    description: 'How deleted messages should look',
    default: 'red',
    options: [
      { value: 'red', label: 'Red font' },
      { value: 'opacity', label: '50% opacity' },
    ],
  },
  ignoreSelf: {
    type: 'boolean',
    label: 'Ignore self',
    description: 'Skip edits and deletes for messages sent by you',
    default: false,
  },
  ignoreAnchors: {
    type: 'select',
    label: 'Ignore anchors',
    description: 'Skip deletions of bot-sent (anchored) messages',
    default: 'off',
    options: [
      { value: 'off', label: 'Off' },
      {
        value: 'lax',
        label: "Don't log any deletions of a message sent by a bot, including on behalf of a user",
      },
      {
        value: 'strict',
        label: "Don't log any deletions of pinned messages sent by a bot, including on behalf of a user",
      },
    ],
  },
} as const satisfies SettingsSchema;
