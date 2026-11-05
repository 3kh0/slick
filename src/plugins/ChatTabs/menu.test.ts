import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addTabMenuItem, addThreadTabAction, THREAD_TAB_ACTION } from './menu.ts';

test('the native context menu keeps its actions and adds the tab option next to window navigation', () => {
  let clicked = false;
  const source = [
    { key: 'split', label: 'Open in split view' },
    { key: 'window', label: 'Open in new window' },
    { key: 'leave', label: 'Leave channel', danger: true },
  ];
  const next = addTabMenuItem(source, () => {
    clicked = true;
  });
  assert.equal(source.length, 3);
  assert.equal(next[2]?.label, 'Open in new Slick tab');
  assert.equal(next[3], source[2]);
  next[2]?.click?.();
  assert.equal(clicked, true);
  assert.equal(
    addTabMenuItem(next, () => {}),
    next,
  );
});

test('menus without a window action place the new option before destructive actions', () => {
  const source = [{ key: 'leave', label: 'Leave channel', danger: true }];
  assert.equal(addTabMenuItem(source, () => {})[0]?.key, 'slick-chat-tabs-open');
  assert.equal(addTabMenuItem([], () => {}).length, 1);
});

test('reply menus add one native action beside reply without changing Slack actions', () => {
  const source = [
    [
      { id: 'reply', name: 'Reply to thread' },
      { id: 'forward', name: 'Forward message' },
    ],
  ];
  const next = addThreadTabAction(source);
  assert.equal(source[0]!.length, 2);
  assert.equal(next[0]![1]?.id, THREAD_TAB_ACTION);
  assert.equal(next[0]![2], source[0]![1]);
  assert.equal(addThreadTabAction(next), next);
});
