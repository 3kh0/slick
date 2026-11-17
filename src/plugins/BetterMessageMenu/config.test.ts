import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalId, CATALOG, defaultConfig, mergeCatalog, type MenuConfig } from './config.ts';

test('canonicalId maps live ids and data-qas (incl. aliases) to catalog ids', () => {
  assert.equal(canonicalId({ id: 'copy_link' }), 'copy_link');
  assert.equal(canonicalId({ id: 'remind_later', 'data-qa': 'remind_me' }), 'remind');
  assert.equal(canonicalId({ id: 'comment', 'data-qa': 'start_thread' }), 'comment');
  assert.equal(canonicalId({ 'data-qa': 'follow_message' }), 'subscribe');
  assert.equal(canonicalId({ id: 'something_unknown' }), '');
});

test('defaultConfig lists every catalog item with its defaults', () => {
  const c = defaultConfig();
  assert.equal(c.order.length, CATALOG.length);
  const copyLink = c.order.find((i) => i.id === 'copy_link');
  assert.equal(copyLink?.big, true);
  const reaction = c.order.find((i) => i.id === 'add_reaction');
  assert.equal(reaction?.hidden, true);
});

test('mergeCatalog returns defaults for missing/garbage input', () => {
  assert.deepEqual(mergeCatalog(undefined), defaultConfig());
  assert.deepEqual(mergeCatalog({ order: 'nope' } as unknown as MenuConfig), defaultConfig());
});

test('mergeCatalog keeps user order + overrides and appends newly-added items', () => {
  // User reordered two items and renamed one; everything else is implicitly default.
  const stored: MenuConfig = {
    order: [
      { id: 'delete_message', label: 'Nuke', big: true },
      { id: 'copy_text', hidden: true },
      { id: 'bogus_removed_id', hidden: true },
    ],
    followCursor: true,
  };
  const merged = mergeCatalog(stored);
  assert.equal(merged.followCursor, true);
  // kept, in order, overrides preserved
  assert.equal(merged.order[0].id, 'delete_message');
  assert.equal(merged.order[0].label, 'Nuke');
  assert.equal(merged.order[1].id, 'copy_text');
  assert.equal(merged.order[1].hidden, true);
  // bogus id dropped
  assert.equal(
    merged.order.some((i) => i.id === 'bogus_removed_id'),
    false,
  );
  // every catalog item is present exactly once
  assert.equal(merged.order.length, CATALOG.length);
  assert.equal(new Set(merged.order.map((i) => i.id)).size, CATALOG.length);
  // a catalog item not in the stored config is appended
  assert.ok(merged.order.some((i) => i.id === 'organize_actions_menu'));
});
