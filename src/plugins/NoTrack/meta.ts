// Shared metadata for NoTrack.
//
// Lives apart from both halves because three consumers need it without pulling
// in the other two: the renderer class, the main-process half, and the build,
// which generates the schema map Preferences and the main process resolve
// settings against.

import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'NoTrack';
export const pluginName = 'No Track';
export const description = "Disable Slack's built-in tracking and telemetry";
export const defaultEnabled = true;

export const settings = {
  blockBeacons: {
    type: 'boolean',
    label: 'Block beacons',
    description: 'Also drop navigator.sendBeacon calls to Slack telemetry endpoints',
    default: true,
  },
} as const satisfies SettingsSchema;
