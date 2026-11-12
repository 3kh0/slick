import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { COMPRESSED_DICTIONARY, decodeDictionary, dictionaryLoader } from './dictionary.ts';
import { blocksToSlackText, compactDictionary, dictionaryLookup, estimateSyllables, findHaiku } from './haiku.ts';

const original = await readFile(new URL('./syllable_counts.txt', import.meta.url), 'utf8');
const compact = compactDictionary(original);
const packed = COMPRESSED_DICTIONARY + gzipSync(compact, { level: 9 }).toString('base64');

test('native gzip reproduces every byte of the compact offline dictionary', async () => {
  assert.equal(await decodeDictionary(packed), compact);
  assert.ok(packed.length < compact.length / 2);
  assert.equal(await decodeDictionary(original), original);
});

test('hosts without native decompression retain the exact dictionary', async (t) => {
  t.mock.property(globalThis, 'DecompressionStream', undefined);
  assert.equal(await decodeDictionary(packed), compact);
});

test('dictionary stays compressed until first use, and concurrent reads share the decode', async (t) => {
  const native = globalThis.DecompressionStream;
  let decompressions = 0;
  t.mock.property(
    globalThis,
    'DecompressionStream',
    class extends native {
      constructor(format: CompressionFormat) {
        decompressions++;
        super(format);
      }
    },
  );
  const load = dictionaryLoader(packed);
  assert.equal(decompressions, 0);
  const first = load();
  assert.equal(load(), first);
  assert.equal(await first, compact);
  assert.equal(await load(), compact);
  assert.equal(decompressions, 1);
});

test('invalid packed data rejects in native and fallback paths instead of becoming a partial dictionary', async (t) => {
  await assert.rejects(decodeDictionary(COMPRESSED_DICTIONARY + btoa('not a gzip stream')));
  await assert.rejects(decodeDictionary(COMPRESSED_DICTIONARY + '!'));
  t.mock.property(globalThis, 'DecompressionStream', undefined);
  await assert.rejects(decodeDictionary(COMPRESSED_DICTIONARY + btoa('not a gzip stream')));
  await assert.rejects(decodeDictionary(COMPRESSED_DICTIONARY + '!'));
});

test('offline dictionary matches the pinned Orpheus data', () => {
  assert.equal(
    createHash('sha256').update(original).digest('hex'),
    'f8f04665147e96cb87d272e464f508b543b80031dfa3b373ccfbdfe2779a3ca6',
  );
  assert.equal(dictionaryLookup(original, 'silence'), 2);
  assert.equal(dictionaryLookup(original, 'again'), 2);
});

test('compacted dictionary gives every word the same count', () => {
  assert.ok(compact.length < original.length / 5);
  for (const line of original.trimEnd().split('\n')) {
    const word = line.slice(0, line.lastIndexOf(' '));
    assert.equal(dictionaryLookup(compact, word) ?? estimateSyllables(word), dictionaryLookup(original, word), word);
  }
});

test('reported quoted message produces the exact haiku Orpheus posted', () => {
  const text = blocksToSlackText([
    {
      type: 'rich_text',
      elements: [
        { type: 'rich_text_quote', elements: [{ type: 'text', text: 'I’m complex.' }] },
        {
          type: 'rich_text_section',
          elements: [{ type: 'text', text: 'ah, that explains my confusion when I was at best' }],
        },
      ],
    },
  ]);
  assert.equal(text, '&gt; I’m complex.\nah, that explains my confusion when I was at best');
  assert.deepEqual(
    findHaiku(text, (word) => dictionaryLookup(original, word)),
    ['gt im complex. ah', 'that explains my confusion', 'when i was at best'],
  );
});
