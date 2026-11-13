import type { PluginCategory, SettingsSchema } from '$slick';

export const id = 'ChatTabs';
export const pluginName = 'Chat Tabs';
export const description =
  'Browser-like tabs for the real power users of Slack. Open channels, DMs, and threads in new tabs to keep organized.';
export const category: PluginCategory = 'app';
export const defaultEnabled = false;
export const settings = {
  chatNavigation: {
    type: 'select',
    label: 'Opening a chat from Slack',
    default: 'new-tab',
    options: [
      { value: 'new-tab', label: 'Adds a tab' },
      { value: 'current-tab', label: 'Replaces the current tab' },
      { value: 'manual', label: 'Only keep chats I add' },
    ],
    description:
      'Only keep chats I add leaves your tabs unchanged while you browse Slack, including threads. Use +, Open in new Slick tab, or a middle-click or Cmd/Ctrl-click on a sidebar chat to add one. Existing tabs are kept when switching modes.',
  },
  threadView: {
    type: 'select',
    label: 'Open thread tabs in',
    default: 'thread',
    options: [
      { value: 'thread', label: 'Thread only' },
      { value: 'channel', label: 'Channel and thread pane' },
    ],
  },
  autoThreadTabs: {
    type: 'boolean',
    label: 'Automatically create tabs for threads',
    description:
      'Opening a thread in the side pane also adds a thread tab. You can always open one from its context menu.',
    default: false,
  },
  showSingleTab: {
    type: 'boolean',
    label: 'Show the tab bar with one tab',
    default: false,
  },
  showInActivity: {
    type: 'boolean',
    label: 'Show tabs in Activity',
    default: true,
  },
  wrapTabSwitching: {
    type: 'boolean',
    label: 'Wrap keyboard tab switching',
    description: 'Continue from the last tab to the first, and vice versa.',
    default: true,
  },
  closeTabSelection: {
    type: 'select',
    label: 'After closing the selected tab',
    default: 'right',
    options: [
      { value: 'right', label: 'Select the tab to the right' },
      { value: 'left', label: 'Select the tab to the left' },
    ],
    description: 'Falls back to the other neighbor at the edge of the tab bar.',
  },
  middleClickCloses: {
    type: 'boolean',
    label: 'Close tabs with a middle click',
    default: true,
  },
  dragToSplit: {
    type: 'boolean',
    label: 'Drag tabs to the right edge to split',
    description: 'Tab reordering remains available when this is off.',
    default: true,
  },
} as const satisfies SettingsSchema;
