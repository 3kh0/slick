import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'CallTimer';
export const pluginName = 'Call Timer';
export const description = 'Show how long you’ve been in a huddle';
export const defaultEnabled = false;

export const settings = {
  format: {
    type: 'select',
    label: 'Format',
    default: 'stopwatch',
    options: [
      { value: 'stopwatch', label: '30d 23:00:42' },
      { value: 'human', label: '30d 23h 0m 42s' },
    ],
  },
} as const satisfies SettingsSchema;
