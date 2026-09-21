// Replace third-party embeds with a click-to-load placeholder.
//
// The frame's `src` is intercepted before it is ever set, so the third party
// is never contacted -- which is the entire point. v1 did the same thing, but
// it was injected at dom-ready, so any embed already on screen had already
// phoned home before the plugin existed. Running before Slack's first script
// is what makes this actually private rather than mostly private.
//
// Clicking the placeholder asks the main half to allow that one URL, then sets
// the real source. v1 routed the click through a fake `slick.click2load`
// hostname that the main half cancelled and redirected; the RPC does the same
// job without a channel Slack could stumble into.

import { SlickPlugin } from '$slick';
import { placeholder, providerFor } from './gate.ts';
import * as meta from './meta.ts';

const MESSAGE_FRAME = [
  '[data-qa="message_container"]',
  '[data-qa="message_content"]',
  '.c-message_kit__message',
  '.c-message_kit__blocks',
  '.c-message_kit__gutter',
  '[data-qa="virtual-list-item"]',
].join(',');

export default class Click2Load extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['spotify', 'soundcloud', 'other'];

  private restore: (() => void) | null = null;
  /** The real source of each gated frame, until someone asks for it. */
  private readonly gated = new WeakMap<HTMLIFrameElement, string>();

  start() {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    if (!descriptor?.set || !descriptor.get || !descriptor.configurable) {
      this.log('HTMLIFrameElement.prototype.src is not patchable in this runtime');
      return;
    }

    const setSrc = descriptor.set;
    // Captured in the closure rather than reached through `this`: the setter
    // has to be a plain function so its `this` stays the frame being written.
    const gate = (frame: HTMLIFrameElement, value: string) => this.gate(frame, value);

    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
      ...descriptor,
      set(this: HTMLIFrameElement, value: string) {
        if (gate(this, value)) return;
        setSrc.call(this, value);
      },
    });

    this.restore = () => Object.defineProperty(HTMLIFrameElement.prototype, 'src', descriptor);

    // The placeholder cannot reach the page directly, so it posts instead.
    const onMessage = (event: MessageEvent) => {
      if (!event.data || (event.data as { slickClick2Load?: boolean }).slickClick2Load !== true) return;
      const frame = [...document.querySelectorAll('iframe')].find(
        (candidate) => candidate.contentWindow === event.source,
      );
      if (frame) void this.load(frame, setSrc);
    };
    window.addEventListener('message', onMessage);
    this.api.signal.addEventListener('abort', () => window.removeEventListener('message', onMessage));
  }

  stop() {
    this.restore?.();
    this.restore = null;
  }

  /** True if the frame was gated and the caller should not set the source. */
  private gate(frame: HTMLIFrameElement, value: string): boolean {
    let provider;
    try {
      // `isConnected` is false when Slack builds the element before inserting
      // it, which is the common case, so absence of a message ancestor only
      // counts against it once the frame is actually in the document.
      const inMessage = !frame.isConnected || !!frame.closest(MESSAGE_FRAME);
      provider = providerFor(String(value), location.href, inMessage);
    } catch {
      return false;
    }
    if (!provider || this.config[provider.key] === true) return false;

    this.gated.set(frame, String(value));
    frame.srcdoc = placeholder(String(value), provider.label);
    return true;
  }

  private async load(frame: HTMLIFrameElement, setSrc: (this: HTMLIFrameElement, value: string) => void) {
    const source = this.gated.get(frame);
    if (!source) return;

    try {
      // The main half blocks these requests outright, so it has to be told
      // before the frame navigates.
      await this.api.main.call('allow', source);
    } catch (error) {
      this.log('could not allow the embed', error);
      return;
    }

    this.gated.delete(frame);
    frame.removeAttribute('srcdoc');
    setSrc.call(frame, source);
  }
}
