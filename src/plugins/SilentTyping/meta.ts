import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'SilentTyping';
export const pluginName = 'Silent Typing';
export const description = 'Never show the "is typing…" indicator to anyone else';
export const defaultEnabled = false;

export const settings = {
  inThreads: {
    type: 'boolean',
    label: 'Also silence thread replies',
    description: 'Hide the typing indicator in thread views as well as channels',
    default: true,
  },
} as const satisfies SettingsSchema;
