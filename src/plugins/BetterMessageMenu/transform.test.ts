import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, type MenuConfig } from './config.ts';
import { applyMenu, BIG_ACTION_CLASS, type ActionGroups } from './transform.ts';

// Slack's menu for the viewer's OWN message (has Edit/Delete).
const own = (): ActionGroups => [
  [{ id: 'add_reaction', name: 'Add reaction' }],
  [{ id: 'comment', 'data-qa': 'start_thread', name: 'Reply in thread' }],
  [{ id: 'share_message', name: 'Forward message' }],
  [{ id: 'edit_message', name: 'Edit message' }],
  [
    { id: 'mark_unread', name: 'Mark unread' },
    { id: 'later', 'data-qa': 'later', name: 'Move to Saved' },
    { id: 'remind_later', 'data-qa': 'remind_me', name: 'Add a reminder' },
    { id: 'subscribe', 'data-qa': 'follow_message', name: 'Turn off notifications for replies' },
  ],
  [
    { id: 'copy_link', name: 'Copy link' },
    { id: 'copy_text', name: 'Copy message' },
  ],
  [
    { id: 'organize_actions_menu', name: 'Organize', submenuActions: [{ id: 'pin', name: 'Pin to channel' }] },
    { id: 'connect_to_apps_actions_menu', name: 'Connect to apps' },
  ],
  [{ id: 'delete_message', name: 'Delete message' }],
  [{ id: 'some_app_shortcut', name: 'Run shortcut' }],
];

// Someone else's message: no Edit/Delete.
const other = (): ActionGroups => [
  [{ id: 'add_reaction', name: 'Add reaction' }],
  [{ id: 'share_message', name: 'Forward message' }],
  [{ id: 'remind_later', 'data-qa': 'remind_me', name: 'Add a reminder' }],
  [
    { id: 'copy_link', name: 'Copy link' },
    { id: 'copy_text', name: 'Copy message' },
  ],
  [{ id: 'organize_actions_menu', name: 'Organize', submenuActions: [{ id: 'pin', name: 'Pin' }] }],
];

const ids = (g: ActionGroups) => g.flat().map((d) => d.id ?? (d['data-qa'] as string));
const find = (g: ActionGroups, id: string) => g.flat().find((d) => d.id === id);
const fixed = (): MenuConfig => ({ ...defaultConfig(), followCursor: false });

test('non-array input is tolerated', () => {
  assert.deepEqual(applyMenu(undefined, defaultConfig(), 'down'), []);
});

test('default config reproduces the image-2 layout on an own message', () => {
  const out = applyMenu(own(), fixed(), 'down');
  // reaction + reply hidden
  assert.equal(find(out, 'add_reaction'), undefined);
  assert.equal(find(out, 'comment'), undefined);
  // icon row at the bottom: Copy link / Edit / Delete, marked + short labels + trash icon
  const row = out[out.length - 1];
  assert.deepEqual(
    row.map((d) => d.id),
    ['copy_link', 'edit_message', 'delete_message'],
  );
  for (const d of row) assert.ok((d.className ?? '').includes(BIG_ACTION_CLASS));
  assert.equal(find([row], 'edit_message')?.name, 'Edit');
  assert.equal(find([row], 'delete_message')?.name, 'Delete');
  assert.equal(find([row], 'delete_message')?.icon, 'trash');
  // Organise absorbs the stray items (Pin already inside)
  const org = find(out, 'organize_actions_menu');
  const kids = (org?.submenuActions ?? []).map((d) => d.id);
  assert.ok(kids.includes('pin') && kids.includes('mark_unread') && kids.includes('later'));
  // subscribe promoted to UNSUBSCRIBE; unknown shortcut survives
  assert.equal(find(out, 'subscribe')?.name, 'UNSUBSCRIBE');
  assert.ok(find(out, 'some_app_shortcut'));
});

test("others' messages swap Forward + Copy message into the row", () => {
  const out = applyMenu(other(), fixed(), 'down');
  const row = out[out.length - 1];
  assert.deepEqual(
    row.map((d) => d.id),
    ['copy_link', 'share_message', 'copy_text'],
  );
  assert.equal(find([row], 'share_message')?.name, 'Forward');
  assert.equal(find([row], 'copy_text')?.name, 'Copy');
  assert.equal(
    out[0].some((d) => d.id === 'share_message' || d.id === 'copy_text'),
    false,
  );
});

test('icon row tags the count so width can fill (3 own, 2 when forwarding is off)', () => {
  const three = applyMenu(own(), fixed(), 'down');
  const row3 = three[three.length - 1];
  assert.equal(row3.length, 3);
  for (const d of row3) assert.ok((d.className ?? '').includes(`${BIG_ACTION_CLASS}-n3`));

  // Someone else's message in a channel with forwarding disabled: no share_message.
  const noForward: ActionGroups = [
    [{ id: 'copy_link', name: 'Copy link' }],
    [{ id: 'copy_text', name: 'Copy message' }],
    [{ id: 'remind_later', 'data-qa': 'remind_me', name: 'Add a reminder' }],
  ];
  const two = applyMenu(noForward, fixed(), 'down');
  const row2 = two[two.length - 1];
  assert.deepEqual(
    row2.map((d) => d.id),
    ['copy_link', 'copy_text'],
  );
  for (const d of row2) assert.ok((d.className ?? '').includes(`${BIG_ACTION_CLASS}-n2`));
});

test('config order drives the main-list order', () => {
  const cfg = defaultConfig();
  // put connect before organize
  const connect = cfg.order.findIndex((i) => i.id === 'connect_to_apps_actions_menu');
  const organize = cfg.order.findIndex((i) => i.id === 'organize_actions_menu');
  const reordered: MenuConfig = { order: [...cfg.order] };
  const [c] = reordered.order.splice(connect, 1);
  reordered.order.splice(
    reordered.order.findIndex((i) => i.id === 'organize_actions_menu'),
    0,
    c,
  );
  const out = applyMenu(own(), reordered, 'down');
  const list = ids(out);
  assert.ok(list.indexOf('connect_to_apps_actions_menu') < list.indexOf('organize_actions_menu'));
  assert.ok(organize >= 0 && connect >= 0);
});

test('hiding an item removes it; renaming overrides the label', () => {
  const cfg = defaultConfig();
  for (const item of cfg.order) {
    if (item.id === 'copy_text') item.hidden = true;
    if (item.id === 'organize_actions_menu') item.label = 'Sort stuff';
  }
  const out = applyMenu(own(), cfg, 'down');
  assert.equal(find(out, 'copy_text'), undefined);
  assert.equal(find(out, 'organize_actions_menu')?.name, 'Sort stuff');
});

test('un-marking big keeps the item in the main list instead of the row', () => {
  const cfg = fixed();
  for (const item of cfg.order) if (item.id === 'edit_message') item.big = false;
  const out = applyMenu(own(), cfg, 'down');
  const row = out[out.length - 1];
  assert.equal(
    row.some((d) => d.id === 'edit_message'),
    false,
  );
  assert.ok(out[0].some((d) => d.id === 'edit_message'));
});

test('followCursor is the default', () => {
  assert.equal(defaultConfig().followCursor, true);
});

test('opening below the cursor: icon row first, then the configured order', () => {
  const out = applyMenu(own(), defaultConfig(), 'down');
  assert.deepEqual(
    out[0].map((d) => d.id),
    ['copy_link', 'edit_message', 'delete_message'],
  );
  assert.deepEqual(
    out[1].slice(0, 5).map((d) => d.id),
    ['copy_text', 'remind_later', 'subscribe', 'organize_actions_menu', 'connect_to_apps_actions_menu'],
  );
});

test('opening above the cursor: the whole menu mirrors, icon row last', () => {
  const down = applyMenu(own(), defaultConfig(), 'down');
  const up = applyMenu(own(), defaultConfig(), 'up');
  assert.deepEqual(
    up[up.length - 1].map((d) => d.id),
    ['copy_link', 'edit_message', 'delete_message'],
  );
  assert.deepEqual(
    up[0].map((d) => d.id),
    down[1].toReversed().map((d) => d.id),
  );
});

test('does not mutate the input groups', () => {
  const input = own();
  const snap = JSON.stringify(input);
  applyMenu(input, defaultConfig(), 'down');
  assert.equal(JSON.stringify(input), snap);
});
