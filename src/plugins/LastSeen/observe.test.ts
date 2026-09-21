import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVITY, ago, prune, when } from './observe.ts';

test('presence_change: only `active` counts as a sighting', () => {
  // An `away` batch arrives in bulk on subscribe; treating it as a sighting
  // would stamp the whole workspace as "seen just now".
  assert.equal(ACTIVITY.presence_change({ presence: 'away', users: ['U1', 'U2'] } as any), undefined);
  assert.deepEqual(ACTIVITY.presence_change({ presence: 'active', users: ['U1', 'U2'] } as any), ['U1', 'U2']);
  assert.equal(ACTIVITY.presence_change({ presence: 'active', user: 'U1' } as any), 'U1');
});

test('message: a bot posting under a user token is not a sighting', () => {
  assert.equal(ACTIVITY.message({ user: 'U1' } as any), 'U1');
  assert.equal(ACTIVITY.message({ user: 'U1', bot_id: 'B1' } as any), undefined);
  assert.equal(ACTIVITY.message({ user: 'U1', app_id: 'A1' } as any), undefined);
});

test('message: an edit credits the editor', () => {
  assert.equal(ACTIVITY.message({ subtype: 'message_changed', message: { edited: { user: 'U9' } } } as any), 'U9');
});

test('when: seconds-with-decimals becomes ms, and nonsense falls back to now', () => {
  assert.equal(when({ event_ts: '1700000000.000100' } as any), 1_700_000_000_000);
  const now = when({ ts: 'nonsense' } as any);
  assert.ok(Math.abs(now - Date.now()) < 1000);
});

test('ago: picks the largest unit that fits', () => {
  const now = 1_000_000_000_000;
  assert.match(ago(now - 3 * 24 * 60 * 60 * 1000, now), /3 days/);
  assert.match(ago(now - 2 * 60 * 60 * 1000, now), /2 hours/);
  assert.match(ago(now - 90 * 1000, now), /minute/);
  assert.equal(ago(now - 5 * 1000, now), 'just now');
});

test('prune: drops expired entries, then the oldest over the cap', () => {
  const now = 1_000_000;
  const seen = new Map([
    ['old', now - 5000],
    ['mid', now - 3000],
    ['new', now - 1000],
    ['stale', now - 90_000],
  ]);

  const pruned = prune(seen, 2, 60_000, now);
  assert.equal(pruned.has('stale'), false, 'past the ttl');
  assert.equal(pruned.size, 2);
  assert.deepEqual([...pruned.keys()].toSorted(), ['mid', 'new']);
});

test('prune: leaves a map under the cap alone', () => {
  const now = 1_000_000;
  const seen = new Map([['a', now]]);
  assert.equal(prune(seen, 10, 60_000, now), seen);
});
