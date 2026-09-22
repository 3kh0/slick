// Play your own sound for Slack notifications.
//
// The swap happens in `HTMLMediaElement.prototype.play` rather than by
// watching for audio elements. Slack creates the element and calls play in the
// same tick, so anything reacting to the element appearing is already too
// late -- v1 lived with that by also patching `Audio` and `Notification`, and
// still missed the first sound after a reload.
//
// Running before Slack's first script is what makes the single patch enough:
// no audio element can exist before it is installed.

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
  /** The source each element had before it was swapped, so stop() can undo it. */
  private readonly originals = new Map<HTMLMediaElement, string>();

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

    // Captured in closures rather than reached through `this`: the patched
    // method has to be a plain function so its `this` stays the media element.
    const swap = (element: HTMLMediaElement) => this.swap(element);
    const log = (...args: unknown[]) => this.log(...args);

    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      try {
        swap(this);
      } catch (error) {
        // Never let this stop a sound playing entirely.
        log('could not swap the sound', error);
      }
      return original.call(this);
    };

    this.restore = () => {
      HTMLMediaElement.prototype.play = original;
    };
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
    const path = this.soundPath;
    const remembered = this.originals.get(element);

    if (!path) {
      // Turned off while an element was already swapped: put it back.
      if (remembered !== undefined && element.src !== remembered) element.src = remembered;
      this.originals.delete(element);
      return;
    }

    if (remembered !== undefined) {
      const next = customSoundUrl(path);
      if (element.src !== next) element.src = next;
      return;
    }

    const src = element.currentSrc || element.src;
    if (!src || !isNotificationSound(src, location.href)) return;

    this.originals.set(element, src);
    element.src = customSoundUrl(path);
  }
}
