// Keyed stylesheet injection: one owned <style> element per key.

type Sheet = {
  css: string;
  key?: string;
  elements: WeakMap<Document, HTMLStyleElement>;
};

// Navigated windows get their own Slick via the preload; pop-outs are
// about:blank windows with no preload, so styles are mirrored into them (see
// slack/childWindows.ts, which calls registerDocument).

const sheets = new Set<Sheet>();
const keyed = new Map<string, Sheet>();

const extraDocuments = new Set<Document>();
const documentListeners = new Set<(doc: Document) => void>();

function liveDocuments(): Document[] {
  return [document, ...[...extraDocuments].filter((doc) => doc.defaultView)];
}

export function registerDocument(doc: Document) {
  if (doc === document || extraDocuments.has(doc)) return;
  extraDocuments.add(doc);
  for (const sheet of sheets) render(sheet, doc);
  for (const listener of documentListeners) {
    try {
      listener(doc);
    } catch (error) {
      console.error('[slick] document listener threw:', error);
    }
  }
}

/** Notified for each additional document, so plugins can set their own up. */
export function onDocument(cb: (doc: Document) => void): () => void {
  documentListeners.add(cb);
  return () => void documentListeners.delete(cb);
}

function render(sheet: Sheet, doc: Document) {
  let element = sheet.elements.get(doc);
  if (!element) {
    element = doc.createElement('style');
    element.dataset.slickStyle = sheet.key ?? '';
    doc.head.appendChild(element);
    sheet.elements.set(doc, element);
  }
  // Re-setting identical text still re-parses the sheet and invalidates style.
  if (element.textContent !== sheet.css) element.textContent = sheet.css;
}

function drop(sheet: Sheet) {
  for (const doc of liveDocuments()) {
    sheet.elements.get(doc)?.remove();
    sheet.elements.delete(doc);
  }
  sheets.delete(sheet);
  if (sheet.key !== undefined) keyed.delete(sheet.key);
}

/**
 * Add or replace a stylesheet. A repeated `key` replaces in place; `null` css
 * removes it. Returns a disposer.
 */
export function setStyle(css: string | null, key?: string): () => void {
  let sheet = key === undefined ? undefined : keyed.get(key);

  if (css === null) {
    if (sheet) drop(sheet);
    return () => {};
  }

  if (!sheet) {
    sheet = { css, key, elements: new WeakMap() };
    sheets.add(sheet);
    if (key !== undefined) keyed.set(key, sheet);
  }
  sheet.css = css;
  for (const doc of liveDocuments()) render(sheet, doc);

  const added = sheet;
  return () => drop(added);
}
