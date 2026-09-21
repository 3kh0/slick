// Disable Slack's built-in tracking.
//
// The main-process half (main.ts) blocks the telemetry hosts at the network
// layer. This half stops the page generating the calls in the first place, so
// Slack is not sitting in a retry loop against requests that will never land.
// Running before Slack's bundle is what makes that possible: the telemetry
// modules are stubbed before anything captures a reference to them.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

const TELEMETRY_FACTORIES = ['getGenericTracer', 'getGenericTelemeter', 'getNoopTelemeter'];

export default class NoTrack extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private restoreBeacon: (() => void) | null = null;

  start() {
    for (const name of TELEMETRY_FACTORIES) {
      this.api.redux.patchThunk(
        (value: any) => value?.meta?.name === name,
        () => () => undefined,
      );
    }

    if (this.config.blockBeacons) this.patchBeacon();
    this.log('telemetry suppressed');
  }

  /**
   * sendBeacon is fire-and-forget and bypasses the request patches, so it
   * needs its own stub. Returning true keeps Slack's callers happy.
   */
  private patchBeacon() {
    const original = navigator.sendBeacon?.bind(navigator);
    if (!original) return;

    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      const href = typeof url === 'string' ? url : url.href;
      if (/slackb\.com|\/beacon\/|\/clog\//.test(href)) return true;
      return original(url, data);
    };
    this.restoreBeacon = () => {
      navigator.sendBeacon = original;
    };
  }

  stop() {
    this.restoreBeacon?.();
    this.restoreBeacon = null;
  }
}
