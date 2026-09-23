import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'HumanCount';
export const pluginName = 'Human Count';
export const description = "Leave bots and apps out of the channel header's member count.";
export const defaultEnabled = false;

export const settings = {
  excludeGuests: {
    type: 'boolean',
    label: 'Also leave out guests',
    description: 'Count only full members, not single- or multi-channel guests',
    default: false,
  },
} as const satisfies SettingsSchema;
