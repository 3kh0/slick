import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { COMPRESSED_DICTIONARY, decodeDictionary, dictionaryLoader } from './dictionary.ts';
import { compactDictionary } from './haiku.ts';

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
