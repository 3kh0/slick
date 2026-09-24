import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'QuickJoin';
export const pluginName = 'Quick Join';
export const description = 'Join channels straight from a link to them, without opening each one first';
export const defaultEnabled = false;

export const settings = {
  doubleClick: {
    type: 'boolean',
    label: 'Double click to join',
    description: "Double click a link to a channel you're not in to join it. A single click still opens it",
    default: true,
  },
  hoverCardButton: {
    type: 'boolean',
    label: 'Join button on code channels',
    description: 'Add a Join button to the code channel hover card, which Slack leaves out for some weird reason',
    default: true,
  },
} as const satisfies SettingsSchema;
