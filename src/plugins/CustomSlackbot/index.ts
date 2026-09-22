// Pure CSS: Slack tags custom responses with their own background class, so
// the avatar and sender name can be replaced without touching React.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

const CUSTOM_RESPONSE = '.c-message_kit__background--labels--custom_response';

/** Quote as a CSS string so a stray quote cannot break out. */
const cssString = (value: unknown): string => JSON.stringify(String(value));

export default class CustomSlackbot extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['name', 'url', 'badge'];

  private apply() {
    const name = String(this.config.name ?? '').trim();
    const avatar = String(this.config.url ?? '').trim();

    const rules = [
      avatar && `${CUSTOM_RESPONSE} .c-message_kit__avatar { background-image: url(${cssString(avatar)}) !important; }`,
      // font-size 0 rather than display:none keeps the button's hit area.
      name && `${CUSTOM_RESPONSE} .c-message__sender_button { font-size: 0 !important; }`,
      name && `${CUSTOM_RESPONSE} .c-message__sender_button::after { content: ${cssString(name)}; font-size: 15px; }`,
      this.config.badge && `${CUSTOM_RESPONSE} [data-qa="custom_response_info_badge"] { display: none !important; }`,
    ].filter(Boolean);

    this.api.setStyle(rules.join('\n'));
  }

  start() {
    this.apply();
  }

  onSettingsChange() {
    this.apply();
  }
}
