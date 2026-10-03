import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openSettings } from './openSettings.ts';

function fixture(url = 'https://app.slack.com/client/T123', minimized = false, destroyed = false) {
  const actions: string[] = [];
  const window = {
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: () => actions.push('restore'),
    show: () => actions.push('show'),
    focus: () => actions.push('focus'),
    webContents: {
      isDestroyed: () => destroyed,
      getURL: () => url,
      send: (channel: string) => actions.push(channel),
    },
  } as unknown as Electron.BrowserWindow;
  return { window, actions };
}

test('menu opens settings in the focused client only', () => {
  const first = fixture();
  const focused = fixture();
  assert.equal(openSettings([first.window, focused.window], focused.window), true);
  assert.deepEqual(first.actions, []);
  assert.deepEqual(focused.actions, ['show', 'focus', 'slick:open-settings']);
});

test('falls back from a utility window and restores the client', () => {
  const utility = fixture('slick://app/editor');
  const client = fixture(undefined, true);
  assert.equal(openSettings([utility.window, client.window], utility.window), true);
  assert.deepEqual(utility.actions, []);
  assert.deepEqual(client.actions, ['restore', 'show', 'focus', 'slick:open-settings']);
});

test('does not send settings to destroyed, sign-in, or non-client windows', () => {
  const windows = [
    fixture('https://app.slack.com/client/T123', false, true),
    fixture('https://slack.com/signin'),
    fixture('https://app.slack.com/client-not-a-client'),
    fixture('https://example.com/client/T123'),
    fixture(''),
  ];
  assert.equal(
    openSettings(
      windows.map(({ window }) => window),
      windows[0].window,
    ),
    false,
  );
  for (const { actions } of windows) assert.deepEqual(actions, []);
  assert.equal(openSettings([], null), false);
});
