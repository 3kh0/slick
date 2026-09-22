// Slack's pop-outs (threads, huddles) are about:blank windows rendered through
// a React portal from the opener: no preload, no Slick, and only Slack's own
// stylesheet <link>s are copied in. Registering them lets css.ts mirror our
// styles. React patches already apply, since the opener's React renders them.

import { patchExportFunction } from './webpack.ts';

const documents = new Set<Document>();
const listeners = new Set<(doc: Document) => void>();

function notify(listener: (doc: Document) => void, doc: Document) {
  try {
    listener(doc);
  } catch (error) {
    console.error('[slick] child window listener threw:', error);
  }
}

function prune() {
  for (const doc of documents) {
    const view = doc.defaultView;
    if (!view || view.closed) documents.delete(doc);
  }
}

export function childWindowDocuments(): Document[] {
  prune();
  return [...documents];
}

export function onChildWindow(listener: (doc: Document) => void): () => void {
  listeners.add(listener);
  for (const doc of childWindowDocuments()) notify(listener, doc);
  return () => void listeners.delete(listener);
}

function register(doc: Document): void {
  if (!doc || doc === document || documents.has(doc)) return;
  documents.add(doc);
  doc.defaultView?.addEventListener('pagehide', () => documents.delete(doc), { once: true });
  for (const listener of listeners) notify(listener, doc);
}

/** Backstop registration via window.open; skips windows that ran their own preload. */
async function adopt(view: Window): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    let doc: Document;
    try {
      if (view.closed) return;
      // A real navigation exposes SlickBridge before any markup.
      if ((view as any).SlickBridge) return;
      doc = view.document;
    } catch {
      return; // cross-origin, so not a Slack pop-out
    }
    if (documents.has(doc)) return;
    // Registering before Slack copies its stylesheets would put our <style> in a discarded <head>.
    if (doc.head?.querySelector('link[rel="stylesheet"]')) return register(doc);
  }
}

let installed = false;

export function installChildWindows(): void {
  if (installed) return;
  installed = true;

  // Runs once per pop-out, after the document settles and before React renders into it.
  patchExportFunction(
    'copyDocumentStylesheets',
    (original) =>
      async function copyDocumentStylesheets(source: Document, target: Document) {
        const result = await original(source, target);
        try {
          register(target);
        } catch (error) {
          console.error('[slick] could not register pop-out document:', error);
        }
        return result;
      },
  );

  // Name-independent fallback in case Slack renames copyDocumentStylesheets,
  // which would otherwise silently leave pop-outs unthemed.
  const open = window.open.bind(window);
  window.open = function slickOpen(...args: Parameters<Window['open']>) {
    const child = open(...args);
    if (child) void adopt(child);
    return child;
  };
}
