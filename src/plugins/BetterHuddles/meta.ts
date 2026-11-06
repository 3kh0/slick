import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'BetterHuddles';
export const pluginName = 'Better Huddles';
export const description =
  "Replace Slack's huddle window with a lighter huddle client: it opens on top of the page you're on and talks to Chime directly";
export const category: PluginCategory = 'sounds';
export const defaultEnabled = false;

export const settings = {
  layout: {
    type: 'select',
    label: 'Open huddles as',
    description: 'You can switch either way during a call with the button in its corner',
    default: 'page',
    options: [
      { value: 'page', label: 'Filling the Slack page' },
      { value: 'window', label: 'A floating window over Slack' },
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
