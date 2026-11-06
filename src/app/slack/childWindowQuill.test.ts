import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { installChildWindowQuill, patchQuillSelection } from './childWindowQuill.ts';

function fixture(value = '@rowan') {
  // An adopted Text keeps its creation realm even after ownerDocument changes.
  const node = runInNewContext('new (class Text { nodeType = 3 })()');
  node.length = value.length;
  const calls: unknown[] = [];
  const range = {
    setStart(text: unknown, offset: number) {
      assert.equal(text, node);
      assert.ok(offset >= 0 && offset <= node.length);
      calls.push(['start', offset]);
    },
    setEnd(text: unknown, offset: number) {
      assert.equal(text, node);
      assert.ok(offset >= 0 && offset <= node.length);
      calls.push(['end', offset]);
    },
    selectNodeContents(text: unknown) {
      assert.equal(text, node);
      calls.push('contents');
    },
    getBoundingClientRect: () => ({ left: 25, right: 35, top: 100, bottom: 120, height: 20, width: 10 }),
  };
  node.ownerDocument = { createRange: () => range };
  const fallback = { left: 5, right: 5, top: 10, bottom: 30, width: 0, height: 20 };
  const selection = {
    scroll: {
      length: () => value.length + 1,
      leaf: (index: number): [any, number] => [{ position: (offset: number) => [node, offset] }, index],
    },
    getBounds(index: number, length = 0) {
      assert.equal(this, selection);
      calls.push(['original', index, length]);
      // Reproduce the upstream error instead of letting a no-op mask it.
      if (node.nodeType === 3 && length === 0) return node.getBoundingClientRect();
      return fallback;
    },
  };
  return { node, selection, calls, fallback };
}

test('pop-out text caret uses its owning document instead of an Element-only method', () => {
  for (const value of ['@rowan', '#slick']) {
    const { selection, calls } = fixture(value);
    assert.throws(() => selection.getBounds(0), /getBoundingClientRect is not a function/);
    calls.length = 0;
    patchQuillSelection(selection);
    assert.deepEqual(selection.getBounds(0), { left: 25, right: 25, top: 100, bottom: 120, height: 20, width: 0 });
    assert.deepEqual(calls, [
      ['start', 0],
      ['end', 1],
    ]);
    calls.length = 0;
    assert.equal(selection.getBounds(value.length).left, 35);
    assert.deepEqual(calls, [
      ['start', value.length - 1],
      ['end', value.length],
    ]);
  }
});

test('document-end clamping, empty text and repeated patching remain safe', () => {
  const { selection, calls } = fixture();
  patchQuillSelection(selection);
  const wrapped = selection.getBounds;
  patchQuillSelection(selection);
  assert.equal(selection.getBounds, wrapped);
  assert.equal(selection.getBounds(99, 4)?.left, 35);
  assert.deepEqual(calls, [
    ['start', 5],
    ['end', 6],
  ]);
  const empty = fixture('');
  patchQuillSelection(empty.selection);
  assert.doesNotThrow(() => empty.selection.getBounds(0));
  assert.deepEqual(empty.calls, ['contents']);
});

test('noncollapsed selections, embeds and missing leaves retain upstream behavior', () => {
  const { selection, node, calls, fallback } = fixture();
  patchQuillSelection(selection);
  assert.equal(selection.getBounds(1, 3), fallback);
  node.nodeType = 1;
  assert.equal(selection.getBounds(0), fallback);
  selection.scroll.leaf = () => [null, 0];
  assert.equal(selection.getBounds(0), fallback);
  assert.deepEqual(calls, [
    ['original', 1, 3],
    ['original', 0, 0],
    ['original', 0, 0],
  ]);
});

test('pop-out listeners patch newly focused editors before their input handlers and detach on close', () => {
  const { selection } = fixture();
  const view = new EventTarget();
  const doc = Object.assign(new EventTarget(), { defaultView: view, querySelectorAll: () => [] });
  installChildWindowQuill(doc as unknown as Document);
  const event = new Event('beforeinput');
  Object.defineProperty(event, 'target', {
    value: { closest: () => ({ __quill: { selection } }) },
  });
  doc.addEventListener('beforeinput', () => assert.doesNotThrow(() => selection.getBounds(0)), { once: true });
  doc.dispatchEvent(event);
  view.dispatchEvent(new Event('pagehide'));
  const later = fixture();
  const next = new Event('focusin');
  Object.defineProperty(next, 'target', { value: { closest: () => ({ __quill: { selection: later.selection } }) } });
  doc.dispatchEvent(next);
  assert.throws(() => later.selection.getBounds(0), /getBoundingClientRect is not a function/);
});
