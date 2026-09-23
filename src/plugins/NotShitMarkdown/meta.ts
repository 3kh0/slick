import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'NotShitMarkdown';
export const pluginName = 'Not Shit Markdown';
export const description = 'Make the composer use normal Markdown instead of Slack markup';
export const defaultEnabled = false;

export const settings = {
  bold: { type: 'boolean', label: 'Bold', description: 'Parse **text** as bold', default: true },
  italic: { type: 'boolean', label: 'Italic', description: 'Parse *text* and _text_ as italic', default: true },
  strike: { type: 'boolean', label: 'Strikethrough', description: 'Parse ~~text~~ as strikethrough', default: true },
  code: { type: 'boolean', label: 'Inline code', description: 'Parse `text` as inline code', default: true },
  links: { type: 'boolean', label: 'Links', description: 'Parse [text](url) as a link', default: true },
} as const satisfies SettingsSchema;
