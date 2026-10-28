import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDuration } from './duration.ts';

const time = (d: number, h: number, m: number, s: number) => ((d * 24 + h) * 60 + m) * 60_000 + s * 1000 + 999;

test('stopwatch format pads and shows hours only once they start', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(time(0, 0, 4, 2)), '04:02');
  assert.equal(formatDuration(time(0, 3, 0, 9)), '03:00:09');
  assert.equal(formatDuration(time(30, 23, 0, 42)), '30d 23:00:42');
});

test('human format names each unit and drops the empty leading ones', () => {
  assert.equal(formatDuration(time(0, 0, 0, 7), true), '7s');
  assert.equal(formatDuration(time(0, 0, 4, 2), true), '4m 2s');
  assert.equal(formatDuration(time(30, 23, 0, 42), true), '30d 23h 0m 42s');
});

test('negative durations clamp to zero', () => {
  assert.equal(formatDuration(-5000), '00:00');
});
