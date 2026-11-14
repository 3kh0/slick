import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textFieldHasContent } from './shortcut.ts';

function field(textContent: string | null, tags: string[] = [], value?: string): Element {
  return {
    textContent,
    ...(value === undefined ? {} : { value }),
    querySelector: (selector: string) => (selector.split(',').some((tag) => tags.includes(tag.trim())) ? {} : null),
  } as Element;
}

test('text fields use their current value rather than their original text', () => {
  assert.equal(textFieldHasContent(field('original text', [], '')), false);
  assert.equal(textFieldHasContent(field('', [], 'hello')), true);
  assert.equal(textFieldHasContent(field('', [], ' \n ')), false);
});

test('empty rich-text placeholders do not prevent tab switching', () => {
  assert.equal(textFieldHasContent(field(null)), false);
  assert.equal(textFieldHasContent(field('', ['p', 'br'])), false);
  assert.equal(textFieldHasContent(field('\uFEFF\n', ['p', 'span', 'br'])), false);
  assert.equal(textFieldHasContent(field('hello', ['p', 'strong'])), true);
});

test('emoji-only and other embedded drafts count as content without text nodes', () => {
  for (const tag of ['img', 'video', 'audio', 'iframe', 'object', 'embed']) {
    assert.equal(textFieldHasContent(field('', ['p', tag])), true, tag);
  }
  assert.equal(textFieldHasContent(field('\uFEFF\uFEFF', ['p', 'span', 'img'])), true);
});
