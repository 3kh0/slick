import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'SlimMessageBox';
export const pluginName = 'Slim Message Box';
export const description = 'ozempic for your message box!';
export const defaultEnabled = false;

export const settings = {
  discordLayout: {
    type: 'boolean',
    label: 'Discord-style one-line layout',
    description: 'Cleaner and more streamlined message input.',
    default: true,
  },
  hideFormatting: {
    type: 'boolean',
    label: 'Hide formatting (Aa)',
    description: 'Remove the rich-text formatting toggle.',
    default: false,
  },
  hideEmoji: {
    type: 'boolean',
    label: 'Hide emoji',
    description: 'Remove the emoji picker button.',
    default: false,
  },
  hideMention: {
    type: 'boolean',
    label: 'Hide mention (@)',
    description: 'Remove the mention-someone button.',
    default: false,
  },
  hideVideo: {
    type: 'boolean',
    label: 'Hide video clip',
    description: 'Remove the record-video-clip button.',
    default: false,
  },
  hideAudio: {
    type: 'boolean',
    label: 'Hide audio clip',
    description: 'Remove the record-audio-clip button.',
    default: false,
  },
  hideSlash: {
    type: 'boolean',
    label: 'Hide shortcuts (/)',
    description: 'Remove the run-shortcut / slash-commands button.',
    default: false,
  },
  hideBroadcast: {
    type: 'boolean',
    label: "Hide 'Also send to #channel'",
    description: 'Remove the broadcast-to-channel checkbox shown in thread replies.',
    default: false,
  },
} as const satisfies SettingsSchema;
