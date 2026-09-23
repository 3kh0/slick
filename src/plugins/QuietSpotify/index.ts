// Turn Spotify embeds down. The work is all in main.ts (the embed is a
// cross-origin iframe); this half exists so the plugin can be enabled and
// configured.

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
