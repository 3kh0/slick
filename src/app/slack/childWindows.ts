// Slick Child Windows
//
// Slack's pop-outs -- threads, huddles, anything opened with
// `disposition=desktop-window` -- are not navigations. Slack opens an
// about:blank window and renders into it through a React portal from the
// opener, so the child never loads a URL and therefore never runs a preload:
// no bridge, no slick.js, no plugins of its own. What it does get is a copy of
// Slack's own stylesheet <link>s and nothing else, so every Slick <style> stays
// behind in the opener and the pop-out renders in stock Slack colours.
//
// Registering those documents is what lets css.ts mirror into them. React
// patches need nothing here: the pop-out renders from the opener's React, so
// patched components are already in effect inside it.

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

/** Live pop-out documents; closed ones are dropped. */
export function childWindowDocuments(): Document[] {
  prune();
  return [...documents];
}

/** Run a callback for every pop-out document, present and future. */
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

/**
 * Wait for a window opened through `window.open` to settle, then register it.
 *
 * Only used as a backstop, and deliberately conservative: it bails on windows
 * that ran their own preload, because those have a whole Slick of their own.
 */
async function adopt(view: Window): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    let doc: Document;
    try {
      if (view.closed) return;
      // A real navigation exposes SlickBridge before it writes any markup, so
      // this is set well before the readiness check below could pass.
      if ((view as any).SlickBridge) return;
      doc = view.document;
    } catch {
      return; // cross-origin, so not a Slack pop-out
    }
    if (documents.has(doc)) return;
    // Slack rebuilds this document, so registering before it copies its own
    // stylesheets in would put our <style> in a <head> about to be discarded.
    if (doc.head?.querySelector('link[rel="stylesheet"]')) return register(doc);
  }
}

let installed = false;

export function installChildWindows(): void {
  if (installed) return;
  installed = true;

  // Slack's own stylesheet copy runs once per pop-out, after the document has
  // settled and before React renders into it -- exactly when our styles need
  // to be there.
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

  // If Slack ever renames that export the hook goes quiet and pop-outs
  // silently lose every Slick style again -- the exact bug this module exists
  // to fix, and one that looks like a theme bug rather than a broken hook.
  // Watching window.open costs nothing and does not depend on any name.
  const open = window.open.bind(window);
  window.open = function slickOpen(...args: Parameters<Window['open']>) {
    const child = open(...args);
    if (child) void adopt(child);
    return child;
  };
}
