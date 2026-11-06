import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'BetterHuddles';
export const pluginName = 'Better Huddles';
export const description =
  'A lighter huddle client with its own window, optional in-page controls, and a direct Chime connection';
export const category: PluginCategory = 'sounds';
export const defaultEnabled = false;

export const settings = {
  layout: {
    type: 'select',
    label: 'Open huddles as',
    description: 'You can switch either way during a call with the button in its corner',
    default: 'separate',
    options: [
      { value: 'separate', label: 'A separate window' },
      { value: 'page', label: 'Inside Slack' },
    ],
  },
  compactNoVideo: {
    type: 'boolean',
    label: 'Shrink people without video',
    description:
      'With two or more people without video, they share square tiles, four small photos to a tile, so you still see who is talking',
    default: true,
  },
} as const satisfies SettingsSchema;
