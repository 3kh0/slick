import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeUntil } from './schedule.ts';

const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const on = (day: number, hours: number, minutes = 0) => new Date(2026, 8, day, hours, minutes);

test('activeUntil: inside and outside a same-day window', () => {
  const rules = [{ days: WEEKDAYS, start: '12:00', end: '13:00', status: 'invisible' }];
  assert.deepEqual(activeUntil(rules, 'invisible', on(23, 12, 30)), on(23, 13));
  assert.equal(activeUntil(rules, 'invisible', on(23, 13)), undefined);
  assert.equal(activeUntil(rules, 'invisible', on(23, 11, 59)), undefined);
  assert.equal(activeUntil(rules, 'ooo', on(23, 12, 30)), undefined);
});

test('activeUntil: overnight windows belong to the day they start', () => {
  const rules = [{ days: [3], start: '22:00', end: '07:00', status: 'ooo' }];
  assert.deepEqual(activeUntil(rules, 'ooo', on(23, 23)), on(24, 7));
  assert.deepEqual(activeUntil(rules, 'ooo', on(24, 6)), on(24, 7));
  // Thursday night is not selected.
  assert.equal(activeUntil(rules, 'ooo', on(24, 23)), undefined);
});

test('activeUntil: back-to-back windows merge', () => {
  const rules = [
    { days: WEEKDAYS, start: '17:00', end: '09:00', status: 'ooo' },
    { days: [0, 6], start: '00:00', end: '00:00', status: 'ooo' },
  ];
  // Friday evening runs through the weekend; Sunday night isn't a weekday start.
  assert.deepEqual(activeUntil(rules, 'ooo', on(25, 18)), on(28, 0));
  // Monday's own evening still ends on Tuesday morning.
  assert.deepEqual(activeUntil(rules, 'ooo', on(28, 18)), on(29, 9));
});

test('activeUntil: a window that never ends is capped at a week', () => {
  const rules = [{ days: EVERY_DAY, start: '00:00', end: '00:00', status: 'ooo' }];
  assert.deepEqual(activeUntil(rules, 'ooo', on(23, 10)), on(30, 10));
});

test('activeUntil: no days selected means inactive', () => {
  assert.equal(activeUntil([{ days: [], start: '00:00', end: '00:00', status: 'ooo' }], 'ooo', on(23, 10)), undefined);
});
