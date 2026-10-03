// iframe `src` property and setAttribute writes are intercepted before
// navigation. A scan also replaces parser-created frames; the main half blocks
// known providers while that scan catches up. Clicking the placeholder asks
// main to allow that one URL, then sets the real source.

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

  private restores: (() => void)[] = [];
  private readonly gated = new Map<HTMLIFrameElement, string>();

  start() {
    this.install(window);
    this.api.onDocument((doc) => {
      const view = doc.defaultView as (Window & typeof globalThis) | null;
      if (view) this.install(view);
    });
  }

  private install(view: Window & typeof globalThis) {
    const { HTMLIFrameElement, Element, MutationObserver, document } = view;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    if (!descriptor?.set || !descriptor.get || !descriptor.configurable) {
      this.log('HTMLIFrameElement.prototype.src is not patchable in this runtime');
      return;
    }

    const setSrc = descriptor.set;
    const setAttribute = Element.prototype.setAttribute;
    // The setter's `this` is the frame, so capture `gate` in the closure.
    const gate = (frame: HTMLIFrameElement, value: string) => this.gate(frame, value);

    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
      ...descriptor,
      set(this: HTMLIFrameElement, value: string) {
        if (gate(this, value)) return;
        setSrc.call(this, value);
      },
    });

    Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
      if (this instanceof HTMLIFrameElement && name.toLowerCase() === 'src' && gate(this, value)) return;
      setAttribute.call(this, name, value);
    };

    const scan = (root: ParentNode) => {
      const frames: HTMLIFrameElement[] =
        root instanceof HTMLIFrameElement ? [root] : [...root.querySelectorAll<HTMLIFrameElement>('iframe[src]')];
      for (const frame of frames) {
        const source = frame.getAttribute('src');
        if (source && this.gate(frame, source)) setAttribute.call(frame, 'src', 'about:blank');
      }
    };
    scan(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') scan(record.target as HTMLIFrameElement);
        else for (const node of record.addedNodes) if (node instanceof Element) scan(node);
      }
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });

    this.restores.push(() => {
      observer.disconnect();
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', descriptor);
      Element.prototype.setAttribute = setAttribute;
    });

    const onMessage = (event: MessageEvent) => {
      if (!event.data || (event.data as { slickClick2Load?: boolean }).slickClick2Load !== true) return;
      const frame = [...document.querySelectorAll('iframe')].find(
        (candidate) => candidate.contentWindow === event.source,
      );
      if (frame) void this.load(frame, setSrc);
    };
    view.addEventListener('message', onMessage, { signal: this.api.signal });
  }

  stop() {
    for (const restore of this.restores) {
      try {
        restore();
      } catch {}
    }
    this.restores = [];
    for (const [frame, source] of this.gated) {
      frame.removeAttribute('srcdoc');
      frame.src = source;
    }
    this.gated.clear();
  }

  /** True if gated; the caller must not set the source. */
  private gate(frame: HTMLIFrameElement, value: string): boolean {
    let provider;
    try {
      // Slack usually sets src before inserting the frame, so a detached frame
      // is treated as in-message.
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
      // Main blocks these requests, so it must be told before navigating.
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
