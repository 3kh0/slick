import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localTime } from './format.ts';

const noon = Date.UTC(2026, 10, 6, 12, 0);

test('localTime formats the zone in 12-hour form', () => {
  assert.equal(localTime('UTC', true, noon), '12:00 PM');
});

test('localTime formats in 24-hour form', () => {
  assert.equal(localTime('Asia/Tokyo', false, noon), '21:00');
});

test('localTime returns nothing without a zone or with an invalid one', () => {
  assert.equal(localTime(undefined, true, noon), '');
  assert.equal(localTime('', true, noon), '');
  assert.equal(localTime('Not/AZone', true, noon), '');
});
