import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fit, waterLevel, type Box, type Phrases } from './fit.ts';

const phrases: Phrases = {
  one: ['', ' is typing'],
  two: ['', ' and ', ' are typing'],
  others: (count) => `${count} others`,
};
const box = (width: number): Box => ({
  width,
  sample: 0,
  fontFamily: 'Lato',
  fontSize: '10px',
  letterSpacing: 'normal',
  regularWeight: '400',
  boldWeight: '700',
  avatar: 0,
});

const measure = (text: string) => text.length;
const truncate = (text: string, width: number) =>
  text.length <= width ? text : `${text.slice(0, Math.max(Math.floor(width) - 1, 0))}…`;

test('waterLevel caps only when the widths overflow', () => {
  assert.equal(waterLevel([10, 20], 30), undefined);
  assert.equal(waterLevel([10, 40], 30), 20);
  assert.equal(waterLevel([40, 40], 30), 15);
});

test('everyone is named when they fit', () => {
  assert.deepEqual(fit(['Ada', 'Bob', 'Cy'], phrases, box(200), measure, truncate), ['Ada', 'Bob', 'Cy']);
});

test('names that do not fit become "N others"', () => {
  const names = ['Ada', 'Bob', 'Cy', 'Dee', 'Eve'];
  const shown = fit(names, phrases, box(40), measure, truncate);
  assert.ok(shown.length >= 1 && shown.length < names.length);
  assert.deepEqual(shown, names.slice(0, shown.length));
});

test('long names are cut to share the room, and one name always shows', () => {
  const small = { ...box(30), fontSize: '1px' };
  const long = 'Firstname Middlename Lastname The Third';
  assert.deepEqual(fit([long], phrases, small, measure, truncate), ['Firstname Middlena…']);
  assert.equal(fit([long, 'Bob'], phrases, { ...small, width: 5 }, measure, truncate).length, 1);
});

test('avatars take room from the names', () => {
  const names = ['Ada', 'Bob', 'Cy'];
  assert.deepEqual(fit(names, phrases, box(30), measure, truncate), names);
  assert.ok(fit(names, phrases, { ...box(30), avatar: 10 }, measure, truncate).length < names.length);
});
