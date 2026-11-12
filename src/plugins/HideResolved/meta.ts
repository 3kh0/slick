import type { PluginCategory, SettingsSchema } from '$slick';

export const id = 'HideResolved';
export const pluginName = 'Hide Resolved Tickets';
export const description = 'Hide resolved questions in help channels so only the open ones are left';
export const category: PluginCategory = 'hackclub';
export const defaultEnabled = false;

export const settings = {
  channels: {
    type: 'text',
    label: 'Help channels',
    description: 'Channel names, separated by commas. * matches anything, so *-help covers #ysws-help and more!',
    default: 'help, *-help',
  },
  hide: {
    type: 'select',
    label: 'Hide',
    default: 'resolved',
    options: [
      { value: 'resolved', label: 'Resolved tickets' },
      { value: 'notOpen', label: 'Everything except open tickets' },
    ],
  },
  openEmoji: {
    type: 'text',
    label: 'Open reaction',
    description: 'The reaction the ticket bot puts on open questions',
    default: 'thinking_face',
  },
  resolvedEmoji: {
    type: 'text',
    label: 'Resolved reaction',
    description: 'The reaction the ticket bot swaps in once a question is resolved',
    default: 'white_check_mark',
  },
} as const satisfies SettingsSchema;
