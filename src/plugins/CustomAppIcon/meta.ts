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
  appearance: {
    type: 'select',
    label: 'Appearance',
    description: 'System follows the icon style in macOS Appearance settings.',
    default: 'system',
    options: [
      { value: 'system', label: 'System' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
  },
  autoInvert: {
    type: 'boolean',
    label: 'Auto-switch inverted icons',
    description:
      'Use the normal icon in light mode and the inverted icon in dark mode, following your system theme. Overrides Appearance.',
    default: false,
  },
} as const satisfies SettingsSchema;
