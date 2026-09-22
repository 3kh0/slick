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

// Windows Slack opens with window.open get their own Slick instance, because
// patch.ts substitutes the preload on those too -- so there is no second
// document to mirror into from here.

const sheets = new Set<Sheet>();
const keyed = new Map<string, Sheet>();

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
  sheet.elements.get(document)?.remove();
  sheet.elements.delete(document);
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
  render(sheet, document);

  const added = sheet;
  return () => drop(added);
}
