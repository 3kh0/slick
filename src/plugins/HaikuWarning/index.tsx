import { SlickPlugin, type Block, type SendCheckContext } from '$slick';
import { openHaikuDialog } from './dialog.ts';
import { blocksToSlackText, dictionaryLookup, findHaiku } from './haiku.ts';
import * as meta from './meta.ts';
import dictionary from './syllable_counts.txt';
import { dictionaryLoader } from './dictionary.ts';

// Orpheus skips this channel (notice_poetry.rb).
const EXCLUDED_CHANNEL = 'C09MATKQM8C';
// Her checklist runs only on messages shorter than this, in code points.
const MAX_LENGTH = 300;
// The pinned Orpheus dictionary is bundled offline; see DICTIONARY-NOTICE.txt.

export default class HaikuWarning extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['addSendCheck'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private prompt: { close: () => void } | null = null;
  private readonly dictionary = dictionaryLoader(dictionary);

  start() {
    this.api.signal.addEventListener('abort', () => this.stop(), { once: true });
    this.api.addSendCheck((blocks, context) => this.check(blocks, context));
  }

  stop() {
    this.prompt?.close();
    this.prompt = null;
  }

  private async check(blocks: Block[], context: SendCheckContext): Promise<boolean> {
    if (context.channelId === EXCLUDED_CHANNEL) return true;
    const haiku = await this.findHaiku(blocks);
    if (this.api.signal.aborted || this.api.isActive?.() === false || !haiku) return true;
    this.prompt?.close();
    return new Promise((resolve) => {
      try {
        const handle = openHaikuDialog(context.targetWindow?.document ?? document, haiku, (approved) => {
          if (this.prompt === handle) this.prompt = null;
          resolve(approved && !this.api.signal.aborted && this.api.isActive?.() !== false);
        });
        this.prompt = handle;
      } catch (error) {
        this.log('could not show warning', error);
        resolve(true);
      }
    });
  }

  private async findHaiku(blocks: Block[]): Promise<string[] | null> {
    try {
      const text = blocksToSlackText(blocks);
      // Ruby's String#length counts code points, not UTF-16 units.
      if ([...text].length >= MAX_LENGTH) return null;
      const words = await this.dictionary();
      return findHaiku(text, (word) => dictionaryLookup(words, word));
    } catch (error) {
      this.log('could not check message', error);
      return null;
    }
  }
}
