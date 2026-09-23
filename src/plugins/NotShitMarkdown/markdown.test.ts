import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeltaOp } from '$slick';
import { parseMarkdown, transformOps, type MarkdownConfig } from './markdown.ts';

const all: MarkdownConfig = { bold: true, italic: true, strike: true, code: true, links: true };
const parse = (text: string) => parseMarkdown(text, {}, all);

test('parses each marker and nested emphasis', () => {
  assert.deepEqual(parse('**bold** __also__ ~~gone~~ `code` *ital* _too_'), [
    { insert: 'bold', attributes: { bold: true } },
    { insert: ' ' },
    { insert: 'also', attributes: { bold: true } },
    { insert: ' ' },
    { insert: 'gone', attributes: { strike: true } },
    { insert: ' ' },
    { insert: 'code', attributes: { code: true } },
    { insert: ' ' },
    { insert: 'ital', attributes: { italic: true } },
    { insert: ' ' },
    { insert: 'too', attributes: { italic: true } },
  ]);
  assert.deepEqual(parse('**bold *and italic***'), [
    { insert: 'bold ', attributes: { bold: true } },
    { insert: 'and italic', attributes: { bold: true, italic: true } },
  ]);
});

test('respects emphasis boundaries and escapes', () => {
  assert.deepEqual(parse('snake_case_identifier'), [{ insert: 'snake_case_identifier' }]);
  assert.deepEqual(parse('a * b * c'), [{ insert: 'a * b * c' }]);
  assert.deepEqual(parse('\\*literal\\*'), [{ insert: '*literal*' }]);
});

test('code suppresses nested formatting', () => {
  assert.deepEqual(parse('`**literal**`'), [{ insert: '**literal**', attributes: { code: true } }]);
});

test('links support balanced parentheses in URLs', () => {
  assert.deepEqual(parse('[docs](https://example.test/a_(b))'), [
    { insert: 'docs', attributes: { link: 'https://example.test/a_(b)' } },
  ]);
});

test('preserves active attributes', () => {
  assert.deepEqual(parseMarkdown('**bold**', { italic: true }, all), [
    { insert: 'bold', attributes: { italic: true, bold: true } },
  ]);
});

test('passes code blocks, embeds, and plain ops through by reference', () => {
  const block: DeltaOp = { insert: '**literal**', attributes: { 'code-block': true } };
  const mention = { insert: { mention: 'U123' } } satisfies DeltaOp;
  const plain: DeltaOp = { insert: 'hello' };
  const input = [block, mention, plain];
  const output = transformOps(input, all);
  assert.equal(output, input);
  assert.equal(output[0], block);
  assert.equal(output[1], mention);
  assert.equal(output[2], plain);
});

test('disabled syntax remains literal', () => {
  assert.deepEqual(parseMarkdown('**bold** *italic*', {}, { ...all, bold: false }), [
    { insert: '**bold** ' },
    { insert: 'italic', attributes: { italic: true } },
  ]);
});
