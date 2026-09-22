// Slick Stylesheets
//
// Keyed stylesheet injection. v1 shipped all plugin CSS through a single
// `webContents.insertCSS` call rebuilt from scratch on every change, plus a
// MutationObserver that re-appended the custom-CSS <style> whenever Slack's own
// style insertion pushed it out of last place. Owning individual <style>
// elements makes both of those unnecessary.

type Sheet = {
  css: string;
  key?: string;
  elements: WeakMap<Document, HTMLStyleElement>;
};

// Windows Slack opens by navigating -- ctrl-clicked links, the in-app browser
// -- get their own Slick instance, because patch.ts substitutes the preload on
// those too. Pop-outs are the other kind: Slack renders into an about:blank
// window from the opener, so no preload ever runs there and the only way those
// documents get Slick's styles is for us to mirror them in. See
// slack/childWindows.ts, which is what calls registerDocument.

const sheets = new Set<Sheet>();
const keyed = new Map<string, Sheet>();

const extraDocuments = new Set<Document>();
const documentListeners = new Set<(doc: Document) => void>();

function liveDocuments(): Document[] {
  return [document, ...[...extraDocuments].filter((doc) => doc.defaultView)];
}

/** Start mirroring every stylesheet, current and future, into `doc`. */
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
  element.textContent = sheet.css;
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
