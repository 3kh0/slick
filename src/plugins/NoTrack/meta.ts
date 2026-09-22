// Separate file so the renderer, main-process half and build can each import
// it without pulling in the others.

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
