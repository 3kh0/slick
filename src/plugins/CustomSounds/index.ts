// Swaps in `HTMLMediaElement.prototype.play`: Slack creates the element and
// calls play in the same tick, so watching for elements is too late. Installed
// before Slack's first script, so no audio element predates the patch. In a
// browser the sound lives in plugin storage and plays from a blob: URL, loaded
// ahead of time because the swap has to be synchronous.

import { SlickPlugin } from '$slick';
import { customSoundUrl, isNotificationSound } from './sounds.ts';
import * as meta from './meta.ts';

export default class CustomSounds extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['soundPath'];

  private restore: (() => void) | null = null;
  /** Pre-swap sources, so stop() can undo. */
  private readonly originals = new Map<HTMLMediaElement, string>();
  private storedUrl: string | null = null;
  private generation = 0;

  private get soundPath(): string {
    return String(this.config.soundPath ?? '').trim();
  }

  start() {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'play');
    const original = HTMLMediaElement.prototype.play;
    if (typeof original !== 'function' || !descriptor?.configurable) {
      this.log('HTMLMediaElement.prototype.play is not patchable in this runtime');
      return;
    }

    // The patched method's `this` is the element, so capture these in closures.
    const swap = (element: HTMLMediaElement) => this.swap(element);
    const log = (...args: unknown[]) => this.log(...args);

    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      try {
        swap(this);
      } catch (error) {
        log('could not swap the sound', error);
      }
      return original.call(this);
    };

    this.restore = () => {
      HTMLMediaElement.prototype.play = original;
    };
    void this.load();
  }

  onSettingsChange() {
    void this.load();
  }

  private async load() {
    if (this.api.loader === 'electron') return;
    const generation = ++this.generation;
    const url = this.soundPath ? await this.api.storedFileUrl('soundPath') : null;
    if (generation !== this.generation || this.api.signal.aborted) {
      if (url) URL.revokeObjectURL(url);
      return;
    }
    if (this.storedUrl) URL.revokeObjectURL(this.storedUrl);
    this.storedUrl = url;
  }

  private soundUrl(): string | null {
    const path = this.soundPath;
    if (!path) return null;
    return this.api.loader === 'electron' ? customSoundUrl(path) : this.storedUrl;
  }

  stop() {
    this.restore?.();
    this.restore = null;
    for (const [element, source] of this.originals) {
      if (element.src !== source) element.src = source;
    }
    this.originals.clear();
  }

  private swap(element: HTMLMediaElement) {
    const next = this.soundUrl();
    const remembered = this.originals.get(element);

    if (!next) {
      // Cleared while swapped: put it back.
      if (remembered !== undefined && element.src !== remembered) element.src = remembered;
      this.originals.delete(element);
      return;
    }

    if (remembered !== undefined) {
      if (element.src !== next) element.src = next;
      return;
    }

    const src = element.currentSrc || element.src;
    if (!src || !isNotificationSound(src, location.href)) return;

    this.originals.set(element, src);
    element.src = next;
  }
}
