// Patches File.prototype's `name` getter so every consumer (upload code, draft
// preview, API call) sees the anonymised name. Cached per File, or the preview
// and the upload would disagree.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const NAME_LENGTH = 7;

export default class AnonymiseFileNames extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['keepExtension'];

  private restore: (() => void) | null = null;
  private readonly names = new WeakMap<File, string>();

  start() {
    const descriptor = Object.getOwnPropertyDescriptor(File.prototype, 'name');
    if (!descriptor?.get || !descriptor.configurable) {
      this.log('File.prototype.name is not patchable in this runtime');
      return;
    }

    const original = descriptor.get;
    // The getter's `this` is the File, so capture these in the closure.
    const names = this.names;
    const anonymise = (real: string) => this.anonymise(real);

    Object.defineProperty(File.prototype, 'name', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get(this: File) {
        let real: string;
        try {
          real = original.call(this);
        } catch {
          return original.call(this);
        }

        const cached = names.get(this);
        if (cached !== undefined) return cached;

        const anonymised = anonymise(real);
        names.set(this, anonymised);
        return anonymised;
      },
    });

    this.restore = () => Object.defineProperty(File.prototype, 'name', descriptor);
    this.log('upload file names anonymised');
  }

  private anonymise(real: string): string {
    const bytes = new Uint32Array(NAME_LENGTH);
    crypto.getRandomValues(bytes);

    let name = '';
    for (let i = 0; i < NAME_LENGTH; i++) name += ALPHABET[bytes[i] % ALPHABET.length];
    return this.config.keepExtension ? name + extensionOf(real) : name;
  }

  stop() {
    this.restore?.();
    this.restore = null;
  }
}

function extensionOf(name: string): string {
  if (typeof name !== 'string') return '';
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}
