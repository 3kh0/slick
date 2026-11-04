import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';

export const id = 'Censorship';
export const pluginName = 'Censorship';
export const description = 'There is no war in Ba Sing Se.';
export const category: PluginCategory = 'messages';
export const defaultEnabled = false;

export const settings = {
  filterProfanity: {
    type: 'boolean',
    label: 'Filter common English profanity',
    description: 'Use a built-in list of common English swear words to your blocked terms. Matches whole words only.',
    default: false,
  },
  terms: {
    type: 'text',
    label: 'Blocked terms',
    description: 'Custom terms to censor, separated by commas or newlines',
    default: 'job, employment',
  },
  style: {
    type: 'select',
    label: 'Blocking style',
    description: 'How matched terms should be replaced',
    default: 'stars',
    options: [
      { value: 'stars', label: 'Stars' },
      { value: 'hashtags', label: 'Hashtags' },
      { value: 'blocks', label: 'Unicode blocks' },
      { value: 'custom', label: 'Custom replacement' },
    ],
  },
  replacement: {
    type: 'text',
    label: 'Custom replacement',
    description: 'Select custom replacement style to use this',
    default: 'uwu',
  },
  keepFirstLetter: {
    type: 'boolean',
    label: 'Keep first letter',
    description: 'Show the first letter of a censored word instead of masking it',
    default: false,
  },
  keepLastLetter: {
    type: 'boolean',
    label: 'Keep last letter',
    description: 'Show the last letter of a censored word instead of masking it',
    default: false,
  },
} as const satisfies SettingsSchema;
