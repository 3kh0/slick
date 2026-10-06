// Slack's main and thread composers use Quill; also cover its Slate editors.
const COMPOSERS =
  '[contenteditable="true"].ql-editor, [contenteditable="true"][data-slate-editor="true"], [data-qa="message_input"][contenteditable="true"], [data-qa="message_input"] [contenteditable="true"]';

export function composerSpellcheck(doc: Document) {
  const originals = new Map<Element, string | null>();
  const restore = () => {
    for (const [editor, value] of originals) {
      if (value === null) editor.removeAttribute('spellcheck');
      else editor.setAttribute('spellcheck', value);
    }
    originals.clear();
  };
  const apply = () => {
    // Release detached/replaced composers rather than retaining them indefinitely.
    for (const [editor, value] of originals) {
      if (editor.isConnected && editor.matches(COMPOSERS)) continue;
      if (value === null) editor.removeAttribute('spellcheck');
      else editor.setAttribute('spellcheck', value);
      originals.delete(editor);
    }
    for (const editor of doc.querySelectorAll(COMPOSERS)) {
      if (!originals.has(editor)) originals.set(editor, editor.getAttribute('spellcheck'));
      if (editor.getAttribute('spellcheck') !== 'false') editor.setAttribute('spellcheck', 'false');
    }
  };
  const containsComposer = (node: Node) =>
    node instanceof Element && (originals.has(node) || node.matches(COMPOSERS) || !!node.querySelector(COMPOSERS));
  const observer = new MutationObserver((records) => {
    if (
      records.some((record) =>
        record.type === 'attributes'
          ? record.target instanceof Element &&
            (originals.has(record.target) ||
              record.target.matches(COMPOSERS) ||
              (record.attributeName === 'data-qa' && !!record.target.querySelector(COMPOSERS)))
          : [...record.addedNodes, ...record.removedNodes].some(containsComposer),
      )
    )
      apply();
  });
  const dispose = () => {
    observer.disconnect();
    restore();
  };
  return {
    update(disabled: boolean) {
      dispose();
      if (!disabled) return;
      observer.observe(doc, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['contenteditable', 'class', 'data-qa', 'data-slate-editor', 'spellcheck'],
      });
      apply();
    },
    dispose,
  };
}
