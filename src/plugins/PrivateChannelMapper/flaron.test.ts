import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidatesFor, parseExport } from './flaron.ts';

test('parseExport accepts only valid private channel records', () => {
  const parsed = parseExport({
    C123456: { latest: 'secret', private: true, history: [{ name: 'old-secret' }, { name: 'secret' }] },
    C222222: { latest: 'public', private: false },
    bad: { latest: 'bad', private: true },
  });
  assert.deepEqual([...parsed], [['C123456', { name: 'secret', previousNames: ['old-secret'] }]]);
});

test('candidatesFor ranks exact, prefix, then substring and caps lookups', () => {
  const index = new Map([
    ['C111111', { name: 'project' }],
    ['C222222', { name: 'project-old' }],
    ['C333333', { name: 'new-project-room' }],
    ['C444444', { name: 'project-hidden' }],
  ]);
  assert.deepEqual(
    candidatesFor(index, 'project', (id) => id !== 'C444444', 2),
    ['C111111', 'C222222'],
  );
});
