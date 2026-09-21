// Replace Slack's typeface with a system font or an uploaded font file.
//
// Slack reads its own font off three custom properties rather than a plain
// `font-family`, so overriding only the latter leaves half the UI on Lato.
//
// An uploaded file is served by the main half over `slick-custom-font://`
// (see main.ts) rather than inlined: a font is ~100KB-1MB of base64 that would
// otherwise be re-parsed on every settings change.
//
// NOTE: v1's renderer also built a font picker inside Slack's Appearance
// preferences. That belongs in Slick's own settings tab, which is Phase 4, so
// it is not ported here. The settings themselves work today.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

const UPLOADED_FAMILY = 'SlickCustomFont';

/** Quote a family name unless it is a bare identifier CSS accepts as-is. */
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
