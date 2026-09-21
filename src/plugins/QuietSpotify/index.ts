// Turn Spotify embeds down.
//
// Entirely main-process work: the embed is a cross-origin iframe, so the page
// half cannot reach it. This exists so the plugin has a renderer half to be
// enabled and configured through -- see main.ts for the mechanism.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

export default class QuietSpotify extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['volume'];

  start() {}
}
