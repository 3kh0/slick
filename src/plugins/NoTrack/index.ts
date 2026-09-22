// Disable Slack's built-in tracking. main.ts blocks the telemetry hosts at the
// network layer; this half stubs sendBeacon, which bypasses webRequest.
//
// Taut also no-ops getGenericTracer / getGenericTelemeter / getNoopTelemeter,
// but those aren't thunk creators in Slack 4.52.155, so patching them by thunk
// name does nothing. See docs/slack-internals.md.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

export default class NoTrack extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private restoreBeacon: (() => void) | null = null;

  start() {
    if (this.config.blockBeacons) this.patchBeacon();
    this.log(this.config.blockBeacons ? 'beacons blocked' : 'beacon blocking is off');
  }

  // Returning true keeps Slack's callers happy.
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
