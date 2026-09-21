import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'LastSeen';
export const pluginName = 'Last Seen';
export const description = 'Show a "last seen" time for other people, based on what your client can observe.';
export const defaultEnabled = false;

export const settings = {
  showLastMessage: {
    type: 'boolean',
    label: 'Show last message',
    description: 'Look up the most recent message you can see from this person.',
    default: true,
  },
  showObservedPresence: {
    type: 'boolean',
    label: 'Show observed presence',
    description: 'Show roughly when we last saw them flip status, based only on presence events seen.',
    default: true,
  },
  trackWatchlist: {
    type: 'boolean',
    label: 'Track opened profiles',
    description:
      'Subscribe to presence for people whose profiles you open, so we keep track of them. Uses a little extra websocket traffic.',
    default: false,
  },
  cacheTtlHours: {
    type: 'number',
    label: 'Cache lifetime (hours)',
    description: 'How long to keep cached last-message lookups and observed data before refreshing/evicting.',
    default: 168,
    min: 1,
    max: 8760,
  },
} as const satisfies SettingsSchema;
