import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';
import { neutralizeBlocks } from './rewrite.ts';

export default class NeutralPronouns extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['onMessageSendBlocks'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly authors = meta.authors;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  start() {
    this.api.onMessageSendBlocks(neutralizeBlocks);
  }
}
