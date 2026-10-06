import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'Snappy';
export const pluginName = 'Snappy';
export const description = 'Make Slack feel more responsive by disabling animations and other slow features';
export const defaultEnabled = true;

export const settings = {
  optimizeDuplicateStyles: {
    type: 'boolean',
    label: 'Reduce duplicate stylesheets (experimental)',
    description: 'Skip identical copies of Slack styles to reduce rendering work',
    default: false,
  },
  optimizeResize: {
    type: 'boolean',
    label: 'Smooth window resizing',
    description: "Pause Slack's layout work while a window edge is being dragged, and let it catch up once",
    default: true,
  },
  optimizeSelectors: {
    type: 'boolean',
    label: 'Faster style updates',
    description: "Rewrite Slack's slowest CSS selectors into equivalent ones Chromium can index",
    default: true,
  },
  ignoreGpuBlocklist: {
    type: 'boolean',
    label: 'Ignore GPU blocklist',
    description: 'Force hardware acceleration features that Chromium disabled for this GPU',
    default: false,
    restartRequired: true,
  },
  disableCrashReporter: {
    type: 'boolean',
    label: 'Disable crash reporter',
    description: 'Prevent Slack from starting Crashpad and adding crash metadata',
    default: true,
    restartRequired: true,
  },
  disableSpellcheck: {
    type: 'boolean',
    label: 'Disable composer spellcheck',
    description: 'Disable native spellchecking in Slack message composers',
    default: false,
  },
} as const satisfies SettingsSchema;

// A page extension cannot change the browser process or Slack's Crashpad.
export const { ignoreGpuBlocklist: _gpu, disableCrashReporter: _crash, ...browserSettings } = settings;
