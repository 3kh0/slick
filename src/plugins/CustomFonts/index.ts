// Slack reads its font off custom properties, not just `font-family`, so
// overriding only the latter leaves half the UI on Lato.
//
// Uploaded files are served by main over `slick-custom-font://` rather than
// inlined as ~1MB of base64 re-parsed on every settings change. In a browser
// there is no main half: the file lives in plugin storage, loaded as a blob: URL.

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

  private generation = 0;
  private fileUrl: string | null = null;

  start() {
    void this.apply();
  }

  onSettingsChange() {
    void this.apply();
  }

  private async fontUrl(file: string): Promise<string | null> {
    if (this.api.loader === 'electron') return `slick-custom-font://local/font?path=${encodeURIComponent(file)}`;
    return this.api.storedFileUrl('fontPath');
  }

  private async apply() {
    const generation = ++this.generation;
    const file = String(this.config.fontPath ?? '').trim();
    const url = file ? await this.fontUrl(file) : null;
    if (generation !== this.generation || this.api.signal.aborted) {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
      return;
    }
    if (this.fileUrl && this.fileUrl !== url) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = url?.startsWith('blob:') ? url : null;

    const family = url ? UPLOADED_FAMILY : String(this.config.fontFamily ?? '').trim();

    if (!family) {
      this.api.setStyle(null);
      return;
    }

    const face = url ? `@font-face { font-family: "${UPLOADED_FAMILY}"; src: url("${url}"); }` : '';

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
