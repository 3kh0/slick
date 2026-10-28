import assert from 'node:assert/strict';
import { test } from 'node:test';
import { typersIn, typingSentence } from './typers.ts';

test('typersIn skips you, other channels and duplicate thread records', () => {
  const records = [
    { channelId: 'C1', memberId: 'U1' },
    { channelId: 'C1', memberId: 'U1', threadTs: '1.0' },
    { channelId: 'C1', memberId: 'U2', threadTs: '1.0' },
    { channelId: 'C1', memberId: 'U3', memberIsSelf: true },
    { channelId: 'C2', memberId: 'U4' },
  ];
  assert.deepEqual(typersIn(records, 'C1', true), ['U1', 'U2']);
  assert.deepEqual(typersIn(records, 'C1', false), ['U1']);
  assert.deepEqual(typersIn(records, 'C3', true), []);
});

test('typingSentence uses Slack’s sentences and folds the rest into "N others"', () => {
  const fill = (text: string, values: Record<string, unknown> = {}) =>
    text.replace(/\{(\w+)[^}]*\}/g, (_, key) => String(values[key]));
  const today = (_: string, { count }: Record<string, unknown> = {}) => `${count} other${count === 1 ? '' : 's'}`;
  assert.equal(typingSentence(['Ada'], fill, today), 'Ada is typing');
  assert.equal(typingSentence(['Ada', 'Bob'], fill, today), 'Ada and Bob are typing');
  assert.equal(typingSentence(['Ada', 'Bob', 'Cy', 'Dee'], fill, today), 'Ada, Bob, Cy and Dee are typing');
  assert.equal(typingSentence(['Ada', 'Bob', 'Cy', 'Dee', 'Eve'], fill, today), 'Ada, Bob, Cy and 2 others are typing');
});
