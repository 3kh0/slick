import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'CopyReacted';
export const pluginName = 'Copy Reacted';
export const description = 'Copy the list of people who reacted to a message';
export const defaultEnabled = false;

export const settings = {
  format: {
    type: 'select',
    label: 'Copy format',
    description: 'How each reactor is represented',
    default: 'mentions',
    options: [
      { value: 'names', label: 'Display names' },
      { value: 'handles', label: 'Usernames (@handle)' },
      { value: 'mentions', label: 'Mentions (<@USER_ID>)' },
    ],
  },
  separator: {
    type: 'select',
    label: 'Separator',
    description: 'How the names are joined',
    default: 'newline',
    options: [
      { value: 'newline', label: 'One per line' },
      { value: 'comma', label: 'Comma separated' },
      { value: 'space', label: 'Space separated' },
    ],
  },
} as const satisfies SettingsSchema;
