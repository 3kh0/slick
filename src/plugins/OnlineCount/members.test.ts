import assert from 'node:assert/strict';
import { test } from 'node:test';
import { channelPeople, estimateOnline, onlineCount, tally, type Query } from './members.ts';

test('channelPeople pages through the people in a channel', async () => {
  const calls: unknown[] = [];
  const query: Query = async (_, { args }) => {
    calls.push(args.marker);
    return args.marker
      ? { results: [{ id: 'U2' }, { id: 'U3' }] }
      : { results: [{ id: 'U1' }, { id: 'U2' }], next_marker: 'm' };
  };
  assert.deepEqual(await channelPeople(query, 'T1', 'C1', 1000), ['U1', 'U2', 'U3']);
  assert.deepEqual(calls, [undefined, 'm']);
});

test('channelPeople stops at the limit', async () => {
  let calls = 0;
  const query: Query = async () => (
    calls++,
    { results: [{ id: `U${calls}` }, { id: `V${calls}` }], next_marker: 'more' }
  );
  assert.equal((await channelPeople(query, 'T1', 'C1', 3)).length, 3);
});

test('onlineCount counts active people once everyone is known', () => {
  const presence = { U1: { presence: 'active' }, U2: { presence: 'away' }, U3: { presence: 'active' } };
  assert.equal(onlineCount(['U1', 'U2', 'U3'], presence), 2);
  assert.equal(onlineCount(['U1', 'U4'], presence), undefined);
  assert.equal(onlineCount([], undefined), 0);
  assert.deepEqual(tally(['U1', 'U2', 'U4'], presence), { known: 2, online: 1 });
});

test('estimateOnline scales the sample up to the channel', () => {
  assert.equal(estimateOnline(100_000, 12, 2000), 600);
  assert.equal(estimateOnline(100_000, 0, 0), undefined);
});
