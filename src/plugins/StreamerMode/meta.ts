import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'StreamerMode';
export const pluginName = 'Streamer Mode';
export const description = 'Blur private information while others may be able to see your screen';
export const defaultEnabled = false;

export const settings = {
  activation: {
    type: 'select',
    label: 'Activation',
    description: 'Turn on during screen shares, or force it on all the time.',
    default: 'screenShare',
    options: [
      { value: 'screenShare', label: 'While screen sharing' },
      { value: 'always', label: 'Always on' },
    ],
  },
  dmPreviewBlur: {
    type: 'select',
    label: 'Hide DM previews',
    description: 'Choose how much direct-message preview UI should be blurred.',
    default: 'all',
    options: [
      { value: 'all', label: 'User and content/time' },
      { value: 'content', label: 'Content/time only' },
    ],
  },
  privateChannelNames: {
    type: 'boolean',
    label: 'Hide private channel names',
    description: 'Hide private channel names in sidebars, popovers, and profile surfaces.',
    default: true,
  },
  vipStatus: {
    type: 'boolean',
    label: 'Hide VIP status',
    description: 'Hide VIP and non-VIP badges.',
    default: true,
  },
  blur: {
    type: 'number',
    label: 'Blur strength (px)',
    description: 'How hard to blur. 4px shows the shape without being readable.',
    default: 4,
    min: 1,
    max: 20,
  },
} as const satisfies SettingsSchema;
