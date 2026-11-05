import type { PluginCategory, SettingsSchema } from '$slick';

export const id = 'ChatTabs';
export const pluginName = 'Chat Tabs';
export const description =
  'Browser-like tabs for the real power users of Slack. Open channels, DMs, and threads in new tabs to keep organized.';
export const category: PluginCategory = 'app';
export const defaultEnabled = false;
export const settings = {
  autoThreadTabs: {
    type: 'boolean',
    label: 'Automatically create tabs for threads',
    description:
      'Opening a thread in the side pane also adds a thread tab. You can always open one from its context menu.',
    default: false,
  },
} as const satisfies SettingsSchema;
