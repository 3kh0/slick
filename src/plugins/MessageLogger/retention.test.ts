import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DAY_MS,
  MAX_EDIT_TEXT,
  MAX_EDITS_PER_MESSAGE,
  MAX_ENTRIES,
  MAX_MESSAGE_BYTES,
  evictable,
  mergeEntry,
  normalize,
  trim,
  weigh,
} from './retention.ts';

const NOW = 1_800_000_000_000;
const at = (daysAgo: number) => ({ at: NOW - daysAgo * DAY_MS });

test('evictable: drops entries past the retention window', () => {
  const entries: [string, { at?: number }][] = [
    ['fresh', at(1)],
    ['old', at(31)],
    ['ancient', at(400)],
  ];
  assert.deepEqual(evictable(entries, 30, NOW), ['old', 'ancient']);
});

test('evictable: retentionDays of 0 disables the age cap', () => {
  assert.deepEqual(evictable([['ancient', at(4000)]], 0, NOW), []);
});

test('evictable: an entry with no timestamp is treated as ancient', () => {
  // `at` is written on every path today, but a blob from an older build or a
  // half-written one must not become immortal by omission.
  assert.deepEqual(evictable([['undated', {}]], 30, NOW), ['undated']);
});

test('evictable: the count cap still applies inside the window', () => {
  const entries: [string, { at?: number }][] = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => [
    `k${i}`,
    { at: NOW - i }, // k0 newest, so the five oldest are the last five
  ]);
  const gone = evictable(entries, 30, NOW);
  assert.equal(gone.length, 5);
  assert.deepEqual(gone.toSorted(), ['k1000', 'k1001', 'k1002', 'k1003', 'k1004'].toSorted());
});

test('evictable: age and count compose without double-counting', () => {
  const entries: [string, { at?: number }][] = [
    ...Array.from({ length: MAX_ENTRIES }, (_, i) => [`live${i}`, { at: NOW - i }] as [string, { at?: number }]),
    ['stale', at(90)],
  ];
  // The stale one goes on age; that alone brings the count back to the cap.
  assert.deepEqual(evictable(entries, 30, NOW), ['stale']);
});

test('trim: leaves a normal message untouched', () => {
  const message = { text: 'hello', blocks: [{ type: 'rich_text' }] } as any;
  assert.deepEqual(trim(message), { text: 'hello', blocks: [{ type: 'rich_text' }] });
});

test('trim: drops heavy fields before touching the text', () => {
  const message = {
    text: 'the part worth keeping',
    blocks: [{ pad: 'x'.repeat(MAX_MESSAGE_BYTES) }],
    attachments: [{ pad: 'y'.repeat(MAX_MESSAGE_BYTES) }],
  } as any;
  const out = trim(message);
  assert.equal(out.text, 'the part worth keeping');
  assert.ok(!('blocks' in out));
  assert.ok(!('attachments' in out));
  assert.ok(weigh(out) <= MAX_MESSAGE_BYTES);
});

test('trim: truncates the text when nothing else is left to drop', () => {
  const message = { text: 'z'.repeat(MAX_MESSAGE_BYTES * 2) } as any;
  const out = trim(message) as { text: string };
  assert.ok(out.text.length < MAX_MESSAGE_BYTES);
  assert.ok(out.text.endsWith('…'));
});

test('weigh: a circular message is rejected rather than thrown over', () => {
  const message: any = { text: 'hi' };
  message.self = message;
  assert.equal(weigh(message), Infinity);
});

test('normalize: clamps an entry stored under the old edit cap', () => {
  const entry = { edits: Array.from({ length: 100 }, (_, i) => ({ oldText: `o${i}`, newText: `n${i}` })) };
  assert.equal(normalize(entry), true);
  assert.equal(entry.edits.length, MAX_EDITS_PER_MESSAGE);
  // The newest revisions are the ones worth keeping.
  assert.deepEqual(entry.edits.at(-1), { oldText: 'o99', newText: 'n99' });
  assert.equal(normalize(entry), false, 'already within the caps');
});

test('normalize: shrinks an oversized stored message', () => {
  const entry = { message: { text: 'hi', blocks: [{ pad: 'x'.repeat(MAX_MESSAGE_BYTES) }] } as any };
  assert.equal(normalize(entry), true);
  assert.ok(weigh(entry.message) <= MAX_MESSAGE_BYTES);
  assert.equal(entry.message.text, 'hi');
});

test('normalize: truncates over-long edit text', () => {
  const entry = { edits: [{ oldText: 'a'.repeat(MAX_EDIT_TEXT * 2), newText: 'b' }] };
  assert.equal(normalize(entry), true);
  assert.equal(entry.edits[0].oldText.length, MAX_EDIT_TEXT);
});

test('normalize: leaves a conforming entry alone', () => {
  const entry = { message: { text: 'hi' } as any, edits: [{ oldText: 'a', newText: 'b' }] };
  assert.equal(normalize(entry), false);
});

test('mergeEntry: a live delete keeps the stored edit history and restarts the clock', () => {
  const stored = { at: NOW - DAY_MS, edits: [{ oldText: 'a', newText: 'b' }] };
  const live = { at: NOW, deleted: true, message: { ts: '1', text: 'b' } };
  assert.deepEqual(mergeEntry<typeof stored & typeof live>(stored as never, live as never), {
    at: NOW,
    deleted: true,
    message: { ts: '1', text: 'b' },
    edits: [{ oldText: 'a', newText: 'b' }],
    user: undefined,
  });
});

test('mergeEntry: live edits follow stored ones, capped, and keep the original age', () => {
  const edit = (n: number) => ({ oldText: String(n), newText: String(n + 1) });
  const stored = {
    at: NOW - DAY_MS,
    user: 'U1',
    deleted: true,
    edits: Array.from({ length: MAX_EDITS_PER_MESSAGE }, (_, i) => edit(i)),
  };
  const live = { at: NOW, edits: [edit(99)] };
  const merged = mergeEntry<{ at: number; user?: string; deleted?: boolean; edits?: typeof live.edits }>(stored, live);
  assert.equal(merged.at, NOW - DAY_MS);
  assert.equal(merged.user, 'U1');
  assert.equal(merged.deleted, true);
  assert.equal(merged.edits?.length, MAX_EDITS_PER_MESSAGE);
  assert.deepEqual(merged.edits?.at(-1), edit(99));
  assert.deepEqual(merged.edits?.[0], edit(1));
});
