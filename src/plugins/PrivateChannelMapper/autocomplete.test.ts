import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasExactChannelResult, mergeChannelResults, normalizeChannelQuery } from './autocomplete.ts';

test('normalizeChannelQuery removes the composer sigil and normalizes case', () => {
  assert.equal(normalizeChannelQuery('  #Secret-Room '), 'secret-room');
  assert.equal(normalizeChannelQuery(undefined), '');
});

test('hasExactChannelResult reads both local and wrapped remote result shapes', () => {
  assert.equal(hasExactChannelResult([{ item: { name: 'Secret-Room' } }], 'secret-room'), true);
  assert.equal(hasExactChannelResult([{ name: 'secret-room-old' }], 'secret-room'), false);
});

test('mergeChannelResults keeps base ordering and deduplicates by channel id', () => {
  const base = [{ item: { id: 'C111111', name: 'one' } }, { id: 'C222222', name: 'two' }];
  const extra = [
    { id: 'C222222', name: 'duplicate' },
    { item: { id: 'C333333', name: 'three' } },
    { name: 'missing-id' },
  ];

  assert.deepEqual(mergeChannelResults(base, extra), [base[0], base[1], extra[1]]);
});
