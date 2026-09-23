import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'oneko';
export const pluginName = 'oneko';
export const description = 'cat follow mouse (real)';
export const defaultEnabled = false;

export const settings = {
  speed: {
    type: 'number',
    label: 'Speed',
    description: 'Pixels the cat moves per frame',
    default: 10,
    min: 1,
    max: 40,
  },
} as const satisfies SettingsSchema;
