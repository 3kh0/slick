import assert from 'node:assert/strict';
import { test } from 'node:test';
import { levelOf } from './level.ts';

test('levelOf steps up at 50, 75 and 90 percent of the limit', () => {
  assert.equal(levelOf(0, 12000), 'normal');
  assert.equal(levelOf(5999, 12000), 'normal');
  assert.equal(levelOf(6000, 12000), 'warn');
  assert.equal(levelOf(9000, 12000), 'high');
  assert.equal(levelOf(10800, 12000), 'danger');
  assert.equal(levelOf(13000, 12000), 'danger');
});

test('levelOf stays normal without a limit', () => {
  assert.equal(levelOf(50000, 0), 'normal');
});
