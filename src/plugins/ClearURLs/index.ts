// Strip tracking parameters by transforming the composer's Delta before Slack
// converts it (`onMessageSendDelta`). Rules come from the main half, since the
// Slack page cannot reach GitHub.

import { SlickPlugin, type Delta } from '$slick';
import { cleanText, cleanUrl, compileExtraRules, type ExtraRule, type Provider } from './clean.ts';
import { compileProviders } from './clean.ts';
import * as meta from './meta.ts';

export default class ClearURLs extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['extraRules'];

  private providers: Provider[] = [];
  private extra: ExtraRule[] = compileExtraRules(this.config.extraRules);

  start() {
    // Registered before the rules arrive; with none it's a no-op.
    this.api.onMessageSendDelta((delta) => this.clean(delta));
    void this.loadRules();
  }

  onSettingsChange() {
    this.extra = compileExtraRules(this.config.extraRules);
  }

  private async loadRules() {
    try {
      const data = await this.api.main.call<unknown>('rules');
      if (this.api.signal.aborted) return;
      this.providers = compileProviders(data);
      this.log(`${this.providers.length} providers loaded`);
    } catch (error) {
      this.log('could not load rules; extra rules only', error);
    }
  }

  private clean(delta: Delta): Delta {
    if (!this.providers.length && !this.extra.length) return delta;

    let fenced = false;
    for (const op of delta.ops) {
      const insert = (op as { insert?: unknown }).insert;
      // Object inserts are embeds; code is left alone even if it contains a URL.
      const code = op.attributes?.code === true || op.attributes?.['code-block'] === true;
      const touchesFence = typeof insert === 'string' && (fenced || insert.includes('```'));
      if (typeof insert === 'string' && !code) {
        const cleaned = this.cleanOutsideFences(insert, fenced);
        if (cleaned !== insert) (op as { insert?: unknown }).insert = cleaned;
        fenced = this.fenceState(insert, fenced);
      }

      // A link pasted over text carries the URL as an attribute, cleaned separately.
      const link = op.attributes?.link;
      if (typeof link === 'string' && !code && !touchesFence) {
        const cleaned = cleanUrl(link, this.providers, this.extra);
        if (cleaned !== link) op.attributes!.link = cleaned;
      }
    }

    return delta;
  }

  private cleanOutsideFences(text: string, initiallyFenced: boolean): string {
    let fenced = initiallyFenced;
    let at = 0;
    let out = '';
    for (let fence = text.indexOf('```'); fence !== -1; fence = text.indexOf('```', at)) {
      const part = text.slice(at, fence);
      out += fenced ? part : cleanText(part, this.providers, this.extra);
      out += '```';
      fenced = !fenced;
      at = fence + 3;
    }
    const rest = text.slice(at);
    return out + (fenced ? rest : cleanText(rest, this.providers, this.extra));
  }

  private fenceState(text: string, initiallyFenced: boolean): boolean {
    let fenced = initiallyFenced;
    for (let at = text.indexOf('```'); at !== -1; at = text.indexOf('```', at + 3)) fenced = !fenced;
    return fenced;
  }
}
