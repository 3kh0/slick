// Slack reads its font off custom properties, not just `font-family`, so
// overriding only the latter leaves half the UI on Lato.
//
// Uploaded files are served by main over `slick-custom-font://` rather than
// inlined as ~1MB of base64 re-parsed on every settings change.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

const UPLOADED_FAMILY = 'SlickCustomFont';

const quoteFamily = (name: string): string => (/^[\w-]+$/.test(name) ? name : JSON.stringify(name));

export default class CustomFonts extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['fontFamily', 'fontPath'];

  start() {
    this.apply();
  }

  onSettingsChange() {
    this.apply();
  }

  private apply() {
    const file = String(this.config.fontPath ?? '').trim();
    const family = file ? UPLOADED_FAMILY : String(this.config.fontFamily ?? '').trim();

    if (!family) {
      this.api.setStyle(null);
      return;
    }

    const face = file
      ? `@font-face { font-family: "${UPLOADED_FAMILY}"; src: url("slick-custom-font://local/font?path=${encodeURIComponent(
          file,
        )}"); }`
      : '';

    const stack = `${quoteFamily(family)}, var(--font-family-fallback)`;
    this.api.setStyle(`
      ${face}
      body {
        --font-family-default: ${stack};
        --font-family-lato: ${stack};
        font-family: ${stack};
      }
    `);
  }
}
