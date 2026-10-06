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
  static readonly requiredAPIs = [] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['spotify', 'soundcloud', 'other'];

  private restores: (() => void)[] = [];
  private readonly gated = new Map<HTMLIFrameElement, { source: string; dispose: () => void }>();
  private allowed = new WeakMap<HTMLIFrameElement, string>();
  private readonly loading = new WeakSet<HTMLIFrameElement>();

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
    const gate = (frame: HTMLIFrameElement, value: string) => this.gate(frame, value, setSrc);

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
        if (source && this.gate(frame, source, setSrc)) setAttribute.call(frame, 'src', 'about:blank');
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
  }

  stop() {
    for (const restore of this.restores) {
      try {
        restore();
      } catch {}
    }
    this.restores = [];
    for (const [frame, { source, dispose }] of this.gated) {
      dispose();
      frame.removeAttribute('srcdoc');
      frame.src = source;
    }
    this.gated.clear();
    this.allowed = new WeakMap();
  }

  /** True if gated; the caller must not set the source. */
  private gate(
    frame: HTMLIFrameElement,
    value: string,
    setSrc: (this: HTMLIFrameElement, value: string) => void,
  ): boolean {
    const source = String(value);
    if (this.allowed.get(frame) === source) return false;
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

    if (this.gated.get(frame)?.source === source) return true;
    this.gated.get(frame)?.dispose();

    // srcdoc inherits Slack's CSP, which blocks inline scripts. Register the
    // handler from Slick instead; Slack's embed sandbox allows same-origin DOM access.
    let removeClick = () => {};
    const bind = () => {
      removeClick();
      const button = frame.contentDocument?.querySelector('button');
      if (!button || !frame.hasAttribute('srcdoc')) return;
      // The transparent frame must use Slack's foreground, not the browser's
      // CanvasText (which can be black while Slack uses a dark theme).
      const doc = frame.ownerDocument;
      frame.contentDocument!.body.style.color = doc.defaultView!.getComputedStyle(doc.body).color;
      const onClick = () => void this.load(frame, setSrc);
      button.addEventListener('click', onClick);
      removeClick = () => button.removeEventListener('click', onClick);
    };
    frame.addEventListener('load', bind);
    this.gated.set(frame, {
      source,
      dispose: () => {
        frame.removeEventListener('load', bind);
        removeClick();
      },
    });
    frame.srcdoc = placeholder(source, provider.label);
    return true;
  }

  private async load(frame: HTMLIFrameElement, setSrc: (this: HTMLIFrameElement, value: string) => void) {
    const entry = this.gated.get(frame);
    if (!entry || this.loading.has(frame)) return;
    const { source } = entry;
    this.loading.add(frame);

    try {
      // Main blocks these requests, so it must be told before navigating.
      await this.api.main.call('allow', source);
    } catch (error) {
      this.log('could not allow the embed', error);
      return;
    } finally {
      this.loading.delete(frame);
    }

    // A stop or a new source may have superseded the click while main replied.
    if (this.api.signal.aborted || this.gated.get(frame) !== entry) return;
    entry.dispose();
    this.allowed.set(frame, source);
    this.gated.delete(frame);
    frame.removeAttribute('srcdoc');
    setSrc.call(frame, source);
  }
}
