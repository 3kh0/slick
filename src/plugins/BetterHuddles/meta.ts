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
    description: 'Separate windows are the default. Floating and minimized views inside Slack are optional.',
    default: 'separate',
    options: [
      { value: 'separate', label: 'A separate window' },
      { value: 'page', label: 'Inside Slack' },
      { value: 'window', label: 'Floating inside Slack' },
      { value: 'minimized', label: 'Minimized inside Slack' },
    ],
  },
  participantSide: {
    type: 'select',
    label: 'Participants beside screen shares',
    default: 'right',
    options: [
      { value: 'left', label: 'Left' },
      { value: 'right', label: 'Right' },
    ],
  },
  compactNoVideo: {
    type: 'boolean',
    label: 'Compact participant strip',
    description:
      'Use a narrower participant strip during screen sharing. Photos stay square and cameras keep their video shape.',
    default: true,
  },
} as const satisfies SettingsSchema;
