// Quill's per-window Selection uses `node instanceof Text`. Slack can adopt
// text nodes from the opener into a pop-out, retaining their original realm.
// Quill then treats the Text as an Element and crashes while opening @ / #.

type Bounds = Pick<DOMRect, 'bottom' | 'height' | 'left' | 'right' | 'top' | 'width'>;
type Leaf = { position(offset: number, inclusive: boolean): [Node, number] };
type Selection = {
  scroll: { length(): number; leaf(index: number): [Leaf | null, number] };
  getBounds(index: number, length?: number): Bounds | null;
};
type QuillContainer = Element & { __quill?: { selection?: Selection } };

const patched = new WeakSet<Selection>();

export function patchQuillSelection(selection: Selection): void {
  if (patched.has(selection)) return;
  const original = selection.getBounds;
  selection.getBounds = function (index, length = 0) {
    // Match Quill's document-end clamping. Noncollapsed selections and embeds
    // retain its existing measurement path.
    const last = this.scroll.length() - 1;
    const start = Math.min(index, last);
    if (Math.min(start + length, last) > start) return original.call(this, index, length);
    const [leaf, offset] = this.scroll.leaf(start);
    if (!leaf) return original.call(this, index, length);
    const [node, position] = leaf.position(offset, true);
    if (node.nodeType !== 3) return original.call(this, index, length);

    const text = node as Text;
    const range = text.ownerDocument.createRange();
    const end = position >= text.length;
    if (text.length === 0) {
      range.selectNodeContents(text);
    } else {
      range.setStart(text, end ? position - 1 : position);
      range.setEnd(text, end ? position : position + 1);
    }
    const rect = range.getBoundingClientRect();
    const left = end ? rect.right : rect.left;
    return { bottom: rect.top + rect.height, height: rect.height, left, right: left, top: rect.top, width: 0 };
  };
  patched.add(selection);
}

/** Install before Slack focuses or accepts input in a pop-out's editor. */
export function installChildWindowQuill(doc: Document): void {
  const patch = (element: Element | null) => {
    const container = element?.closest<QuillContainer>('.ql-container');
    const selection = container?.__quill?.selection;
    if (selection && typeof selection.getBounds === 'function') patchQuillSelection(selection);
  };
  const onInput = (event: Event) => {
    // instanceof Element has the same cross-window problem as instanceof Text.
    const target = event.target as Element | null;
    if (typeof target?.closest === 'function') patch(target);
  };
  for (const event of ['focusin', 'beforeinput', 'keydown']) doc.addEventListener(event, onInput, { capture: true });
  for (const container of doc.querySelectorAll('.ql-container')) patch(container);
  doc.defaultView?.addEventListener(
    'pagehide',
    () => {
      for (const event of ['focusin', 'beforeinput', 'keydown'])
        doc.removeEventListener(event, onInput, { capture: true });
    },
    { once: true },
  );
}
