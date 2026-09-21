// Disable Slack's built-in tracking.
//
// The main-process half (main.ts) blocks the telemetry hosts at the network
// layer, which is what actually stops the data leaving. This half suppresses
// sendBeacon, which bypasses webRequest entirely and so cannot be blocked
// there.
//
// Taut additionally no-ops Slack's telemetry factories, but the names it uses
// (getGenericTracer / getGenericTelemeter / getNoopTelemeter) are not thunk
// creators in Slack 4.52.155 -- a registry dump of all 4,994 named thunks does
// not contain them -- so patching them by thunk name is dead code. Finding
// them as module exports is a discovery task; see docs/slack-internals.md.

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
