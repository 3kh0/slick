import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'Snappy';
export const pluginName = 'Snappy';
export const description = 'Make Slack feel more responsive by disabling animations and other slow features';
export const defaultEnabled = true;

export const settings = {
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
