import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'CustomFonts';
export const pluginName = 'Custom Fonts';
export const description = 'Use any installed system font or upload your own font file.';
export const defaultEnabled = false;

export const settings = {
  fontFamily: {
    type: 'text',
    label: 'System font',
    description: 'The name of an installed font.',
    default: '',
  },
  fontPath: {
    type: 'file',
    label: 'Custom font file',
    description: 'A local TTF, OTF, WOFF, or WOFF2 file. This takes priority over the system font.',
    default: '',
    accept: '.ttf,.otf,.woff,.woff2',
  },
} as const satisfies SettingsSchema;
