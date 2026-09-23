import assert from 'node:assert/strict';
import { test } from 'node:test';
import { humanCount } from './count.ts';

test('humanCount: people only, apps left out', () => {
  assert.equal(humanCount({ member_count: 3, app_count: 7, restricted_member_count: 0 }), 3);
});

test('humanCount: optionally leaves out guests', () => {
  const counts = { member_count: 103487, restricted_member_count: 383, app_count: 83 };
  assert.equal(humanCount(counts), 103487);
  assert.equal(humanCount(counts, true), 103104);
  assert.equal(humanCount({ member_count: 5, restricted_member_count: null }, true), 5);
});

test('humanCount: undefined until counts load', () => {
  assert.equal(humanCount(undefined), undefined);
  assert.equal(humanCount({}), undefined);
  assert.equal(humanCount({ member_count: Number.NaN }), undefined);
});
