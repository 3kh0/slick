import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'CustomSounds';
export const pluginName = 'Custom Sounds';
export const description = 'Override Slack notification sounds with your own audio file.';
export const defaultEnabled = false;

// v1 also declared its own `enabled` boolean alongside the plugin's activation,
// so there were two ways to turn the same thing off. `enabled` is reserved in
// v2; the plugin being on is the only switch.
export const settings = {
  soundPath: {
    type: 'file',
    label: 'Sound file',
    description: 'Local audio file to play for notifications',
    default: '',
    accept: 'audio/*,.aac,.aif,.aiff,.caf,.flac,.m4a,.mp3,.oga,.ogg,.opus,.wav,.webm',
  },
} as const satisfies SettingsSchema;
