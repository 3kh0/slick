import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocksToSlackText, dictionaryLookup, estimateSyllables, findHaiku, humanizeInteger } from './haiku.ts';

const COUNTS: Record<string, number> = {
  a: 1,
  again: 2,
  an: 1,
  frog: 1,
  into: 2,
  jumps: 1,
  old: 1,
  pond: 1,
  silence: 2,
  silent: 2,
  splash: 1,
  the: 1,
  x: 4,
  y: 2,
  z: 1,
};
const lookup = (word: string) => COUNTS[word];

test('findHaiku: splits only at exact 5/7/5 boundaries', () => {
  assert.deepEqual(findHaiku('An old silent pond, a frog jumps into the pond — splash, silence again.', lookup), [
    'an old silent pond',
    'a frog jumps into the pond',
    'splash silence again.',
  ]);
  // x(4) + y(2) overshoots the first line.
  assert.equal(findHaiku('x y z z z z z z z z z z z', lookup), null);
});

test('findHaiku: a short or overlong message is not a haiku', () => {
  assert.equal(findHaiku('an old silent pond', lookup), null);
  assert.equal(findHaiku('an old silent pond a frog jumps into the pond splash silence again frog', lookup), null);
});

test('findHaiku: numbers and dollars are read out as Orpheus reads them', () => {
  // "$5" becomes "dollar five" before counting.
  const counts: Record<string, number> = { dollar: 2, five: 1, one: 1, two: 1 };
  const words = (word: string) => counts[word] ?? COUNTS[word];
  assert.deepEqual(findHaiku('$5 two two ' + 'one '.repeat(12), words), [
    'dollar five two two',
    'one one one one one one one',
    'one one one one one',
  ]);
});

test('humanizeInteger: matches humanize 3.1.0 wording', () => {
  assert.equal(humanizeInteger('0'), 'zero');
  assert.equal(humanizeInteger('1001'), 'one thousand and one');
  assert.equal(humanizeInteger('1100'), 'one thousand, one hundred');
  assert.equal(humanizeInteger('12345'), 'twelve thousand, three hundred and forty-five');
});

test('estimateSyllables: falls back to vowel groups with the Ruby adjustments', () => {
  assert.equal(estimateSyllables('frog'), 1);
  assert.equal(estimateSyllables('lake'), 1);
  assert.equal(estimateSyllables('radio'), 3);
  assert.equal(estimateSyllables('xyz'), 1);
});

test('dictionaryLookup: binary search over the sorted file, first and last lines included', () => {
  const dictionary = 'alpha 2\nbeta 1\nomega 3\n';
  assert.equal(dictionaryLookup(dictionary, 'alpha'), 2);
  assert.equal(dictionaryLookup(dictionary, 'beta'), 1);
  assert.equal(dictionaryLookup(dictionary, 'omega'), 3);
  assert.equal(dictionaryLookup(dictionary, 'missing'), undefined);
  assert.equal(dictionaryLookup('solo 4', 'solo'), 4);
});

test('blocksToSlackText: rebuilds the text field Slack delivers with message events', () => {
  const blocks = [
    {
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_section',
          elements: [
            { type: 'text', text: 'hello ' },
            { type: 'user', user_id: 'U123' },
            { type: 'text', text: ' in ' },
            { type: 'channel', channel_id: 'C456' },
            { type: 'text', text: ' ' },
            { type: 'link', url: 'https://example.com', text: 'example' },
            { type: 'text', text: ' ' },
            { type: 'emoji', name: 'wave' },
          ],
        },
      ],
    },
  ];
  assert.equal(blocksToSlackText(blocks), 'hello <@U123> in <#C456> <https://example.com|example> :wave:');
});

const section = (text: string) => ({ type: 'rich_text_section', elements: [{ type: 'text', text }] });
const richText = (...elements: unknown[]) => [{ type: 'rich_text', elements }];

test('Slack text: quote and code boundaries preserve separate words', () => {
  for (const type of ['rich_text_quote', 'rich_text_preformatted']) {
    const blocks = richText(
      { type, elements: [{ type: 'text', text: 'An old silent pond' }] },
      section('A frog jumps into the pond\nSplash silence again'),
    );
    const prefix = type === 'rich_text_quote' ? '&gt; An old silent pond' : '```An old silent pond```';
    const text = blocksToSlackText(blocks);
    assert.equal(text, `${prefix}\nA frog jumps into the pond\nSplash silence again`);
    assert.equal(Boolean(findHaiku(text, lookup)), type === 'rich_text_preformatted');
  }
});

test('Slack text: quote inline elements stay in the same word', () => {
  assert.equal(
    blocksToSlackText(
      richText({
        type: 'rich_text_quote',
        elements: [
          { type: 'text', text: 'sil' },
          { type: 'text', text: 'ent', style: { bold: true } },
        ],
      }),
    ),
    '&gt; sil*ent*',
  );
});

test('Slack text: ordered-list numbers can both create and break a haiku', () => {
  const numbered = (text: string, offset = 0) =>
    blocksToSlackText(
      richText({
        type: 'rich_text_list',
        style: 'ordered',
        offset,
        elements: [section(text)],
      }),
    );
  // The period prevents a dictionary hit: Orpheus estimates `one.` as two syllables.
  const text = 'old still pond a frog jumps into the pond splash silence again';
  assert.equal(numbered(text), `1. ${text}`);
  assert.ok(findHaiku(numbered(text), lookup));
  assert.equal(findHaiku(numbered(`an ${text}`), lookup), null);
  assert.equal(numbered('hello', 4), '5. hello');
});

test('Slack text: escaped literal characters affect Orpheus syllables', () => {
  const text = (input: string) => blocksToSlackText(richText(section(input)));
  assert.equal(text('<one> & two'), '&lt;one&gt; &amp; two');
  assert.equal(findHaiku(text('an old silent pond & a frog jumps into the pond splash silence again'), lookup), null);
  assert.ok(findHaiku(text('an old silent & a frog jumps into the pond splash silence again'), lookup));
});

test('Slack text: message links are included, with escaped URL and label', () => {
  assert.equal(
    blocksToSlackText(
      richText({
        type: 'rich_text_section',
        elements: [{ type: 'message_mention', url: 'https://example.com/?a=1&b=2', text: 'a & b' }],
      }),
    ),
    '<https://example.com/?a=1&amp;b=2|a &amp; b>',
  );
});

test('Slack text: bullets and existing newlines are preserved without joining words', () => {
  assert.equal(
    blocksToSlackText(
      richText(
        section('before\n'),
        {
          type: 'rich_text_list',
          style: 'bullet',
          elements: [section('one'), section('two')],
        },
        section('\nafter'),
      ),
    ),
    'before\n• one\n• two\nafter',
  );
});
