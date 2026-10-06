import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'MessageLogger';
export const pluginName = 'Message Logger';
export const description = 'Keep deleted and edited messages visible';
export const defaultEnabled = false;

export const settings = {
  saveImages: {
    type: 'boolean',
    label: 'Save image previews',
    description:
      'Cache accessible images while messages are visible and keep previews after deletion. Up to 3 previews per message and 128 deleted messages; large images are resized.',
    default: true,
  },
  retentionDays: {
    type: 'number',
    label: 'Keep history for (days)',
    description: 'Discard logged deletes and edits older than this. 0 keeps them until the entry limit evicts them.',
    default: 30,
    min: 0,
    max: 3650,
  },
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
  ignoreEditsFrom: {
    type: 'text',
    label: 'Ignore edits from',
    description: 'Comma-separated app, user, or bot IDs (e.g. A08GT3TM7A4)',
    default: '',
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
