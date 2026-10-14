// Disable Slack's built-in tracking. main.ts blocks the telemetry hosts at the
// network layer; this half fails the same requests inside the page, which covers
// sendBeacon (it bypasses webRequest) and loaders that can't block requests.
//
// Taut also no-ops getGenericTracer / getGenericTelemeter / getNoopTelemeter,
// but those aren't thunk creators in Slack 4.52.155, so patching them by thunk
// name does nothing.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';
import { blockTelemetry } from './telemetry.ts';

export default class NoTrack extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = [] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private unblock: (() => void) | null = null;

  start() {
    this.unblock = blockTelemetry(window, { beacons: this.config.blockBeacons });
    this.log(`telemetry requests blocked in page${this.config.blockBeacons ? ', beacons included' : ''}`);
  }

  stop() {
    this.unblock?.();
    this.unblock = null;
  }
}
