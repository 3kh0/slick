import type { PluginCategory, SettingsSchema } from '../../shared/settings.ts';
import { ICONS } from './icons.ts';

export const id = 'CustomAppIcon';
export const pluginName = 'Custom App Icon';
export const description = 'Swap the Slick dock and taskbar icon for a built-in design or your own image.';
export const category: PluginCategory = 'appearance';
export const authors = 'JosTheDude';
export const defaultEnabled = false;

export const settings = {
  icon: {
    type: 'select',
    label: 'Icon',
    default: 'slick',
    options: [...ICONS.map((icon) => ({ value: icon.id, label: icon.label })), { value: 'custom', label: 'Custom' }],
    hidden: true,
  },
} as const satisfies SettingsSchema;
