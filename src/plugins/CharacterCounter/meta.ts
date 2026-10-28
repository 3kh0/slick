import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'CharacterCounter';
export const pluginName = 'Character Counter';
export const description = 'Show how many characters your message has next to the send button';
export const category: PluginCategory = 'composer';
export const defaultEnabled = false;

export const settings = {
  colorEffects: {
    type: 'boolean',
    label: 'Color as you near the limit',
    description: 'Turn the counter yellow, orange, then red as the message gets closer to Slack’s limit.',
    default: true,
  },
} as const satisfies SettingsSchema;
