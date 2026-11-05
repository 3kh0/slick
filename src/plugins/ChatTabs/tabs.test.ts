import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  closeTab,
  adjacentTab,
  currentThread,
  currentTab,
  dragScrollSpeed,
  threadTabForMessage,
  moveTab,
  MAX_TABS,
  readTab,
  restoreTabs,
  tabKey,
  tabUri,
  splitProps,
  visitTab,
} from './tabs.ts';

test('channel, DM and thread routes round trip through Slack deep links', () => {
  assert.deepEqual(readTab('/client/T123/C123'), { channel: 'C123' });
  assert.deepEqual(readTab('/client/E123/D123'), { channel: 'D123' });
  const thread = { channel: 'C123', thread: '1770000000.123456' };
  assert.deepEqual(readTab('/client/E123/C123/thread/C123-1770000000.123456'), thread);
  assert.deepEqual(readTab('/client/T123/C123?thread_ts=1770000000.123456'), thread);
  assert.equal(tabUri('E123', thread), 'slack://channel?team=E123&id=C123&thread_ts=1770000000.123456');
  assert.equal(readTab('/client/T123/activity'), null);
  assert.equal(readTab('/client/T123/channel-browser'), null);
  assert.equal(readTab('/client/T123/C123invalid'), null);
});

test('restoring storage rejects malformed data and only retains unique destinations', () => {
  assert.deepEqual(restoreTabs(null), []);
  assert.deepEqual(
    restoreTabs([
      null,
      {},
      { channel: 'javascript:foo' },
      { channel: 'C123', thread: {} },
      { channel: 'C123', thread: 'bad' },
      { channel: 'C123', secret: 'discard' },
      { channel: 'C123' },
    ]),
    [{ channel: 'C123' }],
  );
  assert.equal(restoreTabs(Array.from({ length: 100 }, (_, i) => ({ channel: `C${i}` }))).length, MAX_TABS);
});

test('visiting reuses existing tabs, keeps threads separate and bounds retention', () => {
  const tabs = [{ channel: 'C123' }];
  assert.equal(visitTab(tabs, { channel: 'C123' }), tabs);
  assert.equal(visitTab(tabs, { channel: 'C123', thread: '1770000000.123456' }).length, 2);
  const full = restoreTabs(Array.from({ length: MAX_TABS }, (_, i) => ({ channel: `C${i}` })));
  const next = visitTab(full, { channel: 'D999' });
  assert.equal(next.length, MAX_TABS);
  assert.equal(next[0]?.channel, 'C1');
  assert.equal(next.at(-1)?.channel, 'D999');
});

test('closing selects the adjacent tab and never closes the final tab', () => {
  const tabs = [{ channel: 'C1' }, { channel: 'C2' }, { channel: 'C3' }];
  assert.deepEqual(closeTab(tabs, 'C2:', 'C2:').next, tabs[2]);
  assert.deepEqual(closeTab(tabs, 'C3:', 'C3:').next, tabs[1]);
  assert.equal(closeTab(tabs, 'C1:', 'C3:').next, undefined);
  assert.equal(closeTab(tabs, 'missing', 'C3:').tabs, tabs);
  assert.equal(closeTab([tabs[0]!], tabKey(tabs[0]!), 'C1:').tabs.length, 1);
  assert.deepEqual(closeTab(tabs, 'C2:', 'C2:', 'left').next, tabs[0]);
  assert.deepEqual(closeTab(tabs, 'C1:', 'C1:', 'left').next, tabs[1]);
  assert.equal(closeTab(tabs, 'C2:', 'C1:', 'left').next, undefined);
});

test('keyboard switching can wrap or stop at the edges without losing the selection', () => {
  const tabs = [{ channel: 'C1' }, { channel: 'D2' }, { channel: 'C3' }];
  assert.equal(adjacentTab(tabs, 'C1:', -1), tabs[2]);
  assert.equal(adjacentTab(tabs, 'C3:', 1), tabs[0]);
  assert.equal(adjacentTab(tabs, 'C1:', -1, false), undefined);
  assert.equal(adjacentTab(tabs, 'C3:', 1, false), undefined);
  assert.equal(adjacentTab(tabs, 'D2:', -1, false), tabs[0]);
  assert.equal(adjacentTab(tabs, 'missing', 1), undefined);
  assert.equal(adjacentTab([], undefined, 1), undefined);
});

test('thread selection follows the active workspace view even when the URL stays on the channel', () => {
  const view = Object.create({
    'v2::main::home::secondary': { viewType: 'Thread', params: { threadId: 'C123-1770000000.123456' } },
  });
  const state = { window: { main: { activeTab: 'home' } }, view };
  assert.equal(currentThread(state, 'C123'), '1770000000.123456');
  assert.equal(currentThread(state, 'D123'), undefined);
  assert.equal(currentThread({ ...state, window: { main: { activeTab: 'dms' } } }, 'C123'), undefined);
  assert.equal(currentThread({ window: state.window, view: {} }, 'C123'), undefined);
  assert.equal(currentThread(null, 'C123'), undefined);
});

test('dragging reorders before or after targets without changing destinations', () => {
  const tabs = [{ channel: 'C1' }, { channel: 'D2' }, { channel: 'G3' }];
  assert.deepEqual(moveTab(tabs, 'C1:', 'G3:', true), [tabs[1], tabs[2], tabs[0]]);
  assert.deepEqual(moveTab(tabs, 'G3:', 'C1:'), [tabs[2], tabs[0], tabs[1]]);
  assert.deepEqual(moveTab(tabs, 'C1:', 'G3:'), [tabs[1], tabs[0], tabs[2]]);
  assert.equal(moveTab(tabs, 'C1:', 'D2:'), tabs);
  assert.equal(moveTab(tabs, 'C1:', 'C1:'), tabs);
  assert.equal(moveTab(tabs, 'missing', 'G3:'), tabs);
});

test('thread split navigation uses Slack’s native thread descriptor', () => {
  assert.deepEqual(splitProps({ channel: 'C1' }), { id: 'C1', viewType: 'Channel' });
  assert.deepEqual(splitProps({ channel: 'C1', thread: '1770000000.123456' }), {
    id: 'thread',
    viewType: 'Thread',
    params: { threadId: 'C1-1770000000.123456', highlightRoot: true },
  });
});

test('full-page thread tabs remain selected when Slack removes the channel from the URL', () => {
  const state = {
    window: { main: { activeTab: 'home' } },
    view: Object.create({
      'v2::main::home::primary': { viewType: 'Thread', params: { threadId: 'C1-1770000000.123456' } },
    }),
  };
  assert.deepEqual(currentTab('/client/E1', state), { channel: 'C1', thread: '1770000000.123456' });
  assert.deepEqual(currentTab('/client/E1/D1', {}), { channel: 'D1' });
});

test('ordinary side-pane threads keep the channel selected unless automatic thread tabs are enabled', () => {
  const state = {
    window: { main: { activeTab: 'home' } },
    view: Object.create({
      'v2::main::home::primary': { viewType: 'Channel', id: 'C1' },
      'v2::main::home::secondary': { viewType: 'Thread', params: { threadId: 'C1-1770000000.123456' } },
    }),
  };
  const route = '/client/E1/C1?thread_ts=1770000000.123456';
  assert.deepEqual(currentTab(route, state), { channel: 'C1' });
  assert.deepEqual(currentTab(route, state, true), { channel: 'C1', thread: '1770000000.123456' });
  assert.deepEqual(currentTab(route, {}), { channel: 'C1' });
});

test('reply menu targets resolve to the root thread and reject invalid destinations', () => {
  const state = {
    messages: Object.create({ C1: Object.create({ '1770000001.123456': { thread_ts: '1770000000.123456' } }) }),
  };
  assert.deepEqual(threadTabForMessage('C1', '1770000001.123456', undefined, state), {
    channel: 'C1',
    thread: '1770000000.123456',
  });
  assert.deepEqual(threadTabForMessage('C1', '1770000000.123456', undefined, {}), {
    channel: 'C1',
    thread: '1770000000.123456',
  });
  assert.equal(threadTabForMessage('javascript:bad', '1770000000.123456', undefined, {}), null);
  assert.equal(threadTabForMessage('C1', 'not-a-timestamp', undefined, {}), null);
  for (const channel of ['C1', 'D1', 'G1'])
    assert.deepEqual(splitProps({ channel }), { id: channel, viewType: 'Channel' });
});

test('drag auto-scroll accelerates at the strip edges and stops outside the strip', () => {
  assert.equal(dragScrollSpeed(100, 0, 200), 0);
  assert.equal(dragScrollSpeed(0, 0, 200), -14);
  assert.equal(dragScrollSpeed(200, 0, 200), 14);
  assert.ok(dragScrollSpeed(10, 0, 200) < dragScrollSpeed(30, 0, 200));
  assert.equal(dragScrollSpeed(201, 0, 200), 0);
  assert.equal(dragScrollSpeed(0, 0, 0), 0);
});
