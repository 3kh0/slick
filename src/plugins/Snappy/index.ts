// Make Slack feel more responsive.
//
// The renderer half is only CSS. Spellcheck and the Chromium switches are
// process-level concerns and live in main.ts: v1 disabled spellcheck by
// subscribing to the DOM hub and setting an attribute on every contenteditable
// it found, which is both a per-mutation cost and the wrong layer -- Electron
// can just turn the spellchecker off for the session.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

// Slack animates almost everything through transitions; collapsing the
// duration is what actually makes the client feel immediate.
const NO_TRANSITIONS = `
  .p-client_container,
  .p-client_container * {
    transition-duration: .01ms !important;
    transition-delay: 0s !important;
  }
`;

export default class Snappy extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['disableSpellcheck'];
  // Chromium switches are read once at process start, so these cannot apply live.
  static readonly relaunchSettings = ['ignoreGpuBlocklist', 'disableCrashReporter'];

  start() {
    this.api.setStyle(NO_TRANSITIONS, 'transitions');
    this.log('animations disabled');
  }
}
