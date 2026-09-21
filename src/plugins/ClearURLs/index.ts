// Strip tracking parameters from URLs before they are sent.
//
// v1 rewrote the outgoing HTTP request body: it patched `fetch` and
// `XMLHttpRequest`, matched the chat API endpoints, pulled the serialized
// blocks back out and re-parsed them. It also received the rule set by having
// the main process `executeJavaScript` a JSON blob into a global on every
// dom-ready.
//
// v2 transforms the composer's Delta before Slack converts it, through the
// shared `onMessageSendDelta` hook, and asks the main half for the rules once.
//
// The rules are fetched in the main process because they come from GitHub and
// the Slack page cannot reach it -- see main.ts.

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
    // Registered before the rules arrive: with none, the transform is a no-op,
    // which is the right behaviour anyway if the fetch never succeeds.
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

    for (const op of delta.ops) {
      const insert = (op as { insert?: unknown }).insert;
      // An object insert is an embed -- a mention, an emoji, a file. Nothing
      // to clean, and rewriting it would break it.
      if (typeof insert === 'string') {
        const cleaned = cleanText(insert, this.providers, this.extra);
        if (cleaned !== insert) (op as { insert?: unknown }).insert = cleaned;
      }

      // A link the user pasted over text carries the URL as an attribute, so
      // the visible text and the href have to be cleaned separately.
      const link = op.attributes?.link;
      if (typeof link === 'string') {
        const cleaned = cleanUrl(link, this.providers, this.extra);
        if (cleaned !== link) op.attributes!.link = cleaned;
      }
    }

    return delta;
  }
}
