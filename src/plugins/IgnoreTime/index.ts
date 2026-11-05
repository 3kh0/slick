import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

const CSS = `.c-timestamp__label { -webkit-user-select: none; user-select: none; }`;

export default class IgnoreTime extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  start() {
    this.api.setStyle(CSS, 'ignore-time');
    this.api.signal.addEventListener('abort', () => this.api.setStyle(null, 'ignore-time'), { once: true });
  }
}
