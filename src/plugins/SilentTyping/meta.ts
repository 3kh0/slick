import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'SilentTyping';
export const pluginName = 'Silent Typing';
export const description = 'Never show the "is typing…" indicator to anyone else';
export const defaultEnabled = false;

export const settings = {
  active: {
    type: 'boolean',
    label: 'Silence typing',
    description: 'Also toggled by the message box button',
    default: true,
  },
  composerButton: {
    type: 'boolean',
    label: 'Show toggle in message box',
    description: 'Add a button to the message box that turns silent typing on and off',
    default: true,
  },
  inThreads: {
    type: 'boolean',
    label: 'Also silence thread replies',
    description: 'Hide the typing indicator in thread views as well as channels',
    default: true,
  },
} as const satisfies SettingsSchema;
