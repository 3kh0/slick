import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('./index.tsx', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { default: AccountSwitcher } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

test('browser menu routes switching and adding to trusted UI without capturing credentials', async () => {
  const calls: unknown[][] = [];
  const plugin = new AccountSwitcher(
    {
      loader: 'extension',
      Store: class {
        set() {}
      },
      elements: {},
      main: {
        call: async (...args: unknown[]) => {
          calls.push(args);
        },
      },
    },
    {},
  );
  plugin.captureCurrent = async () => {
    throw new Error('Browser must not capture through the page');
  };
  await plugin.switchTo('U123456');
  await plugin.addAccount();
  assert.deepEqual(calls, [['open', 'U123456'], ['open']]);
});

test('switch errors distinguish current-account capture from target-account rejection', async (t) => {
  const alerts: string[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { alert: (text: string) => alerts.push(text) },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  const plugin = new AccountSwitcher(
    {
      Store: class {
        value: unknown;
        set(value: unknown) {
          this.value = value;
        }
      },
      elements: {},
      main: {
        call: async () => {
          throw new Error('Slack rejected this session (token_revoked).');
        },
      },
    },
    {},
  );
  plugin.log = () => {};
  plugin.captureCurrent = async () => {
    throw new Error('Slack rejected this session (invalid_auth).');
  };
  await plugin.switchTo('U123456');
  assert.match(alerts[0]!, /Saving the current account failed:.*invalid_auth/);
  plugin.captureCurrent = async () => null;
  await plugin.switchTo('U123456');
  assert.match(alerts[1]!, /Verifying or restoring the target account failed:.*token_revoked/);
});

test('OAuth session notifications wake the capture loop instead of waiting for its retry timer', async () => {
  const controller = new AbortController();
  let notify!: () => void;
  const plugin = new AccountSwitcher(
    {
      Store: class {
        value: unknown;
        set(value: unknown) {
          this.value = value;
        }
      },
      elements: {},
      members: {},
      signal: controller.signal,
      patchComponent: () => {},
      main: {
        on: (event: string, callback: () => void) => {
          assert.equal(event, 'session-changed');
          notify = callback;
        },
      },
    },
    {},
  );
  plugin.captureAndRefresh = async () => {};
  plugin.start();
  const waiting = plugin.delay(60_000);
  notify();
  await waiting;
  assert.equal(plugin.sessionRevision, 1);
  assert.equal(plugin.wakeCapture, undefined);
  controller.abort();
});

test('the running switcher captures a redirect login even after the initial startup retry window', async (t) => {
  const controller = new AbortController();
  const main = { user_id: 'U123456', token: 'main-token', url: 'https://enterprise.slack.com/' };
  const alt = { ...main, user_id: 'U654321', token: 'test-token' };
  const config = { teams: { T123456: main }, lastActiveTeamId: 'T123456' };
  let liveUserId = main.user_id;
  const saved = new Map<string, unknown>();
  let captures = 0;
  let menu: { userId: string }[] = [];
  for (const [key, value] of Object.entries({
    localStorage: { getItem: () => JSON.stringify(config) },
    location: { pathname: '/client/T123456' },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  class Store {
    set(value: { userId: string }[]) {
      menu = value;
    }
  }
  const plugin = new AccountSwitcher(
    {
      Store,
      elements: {},
      signal: controller.signal,
      members: { getCurrentMemberId: () => liveUserId },
      main: {
        call: async (method: string, teamId: string, team: typeof main) => {
          if (method === 'list') return [...saved.values()];
          assert.equal(method, 'capture');
          assert.equal(team.user_id, liveUserId);
          captures++;
          const account = { userId: team.user_id, teamId, updatedAt: captures };
          saved.set(account.userId, account);
          return account;
        },
      },
    },
    {},
  );
  let ticks = 0;
  plugin.delay = async () => {
    ticks++;
    if (ticks === 12) liveUserId = alt.user_id;
    // Redirect identity changes before localConfig is persisted.
    if (ticks === 13) {
      assert.equal(captures, 1);
      assert.equal(
        menu.some((account) => account.userId === alt.user_id),
        false,
      );
      config.teams.T123456 = alt;
    }
    if (ticks === 14) plugin.sessionRevision++; // OAuth rotates the cookie without changing localConfig.
    if (ticks === 16) controller.abort();
  };
  await plugin.captureAndRefresh();
  assert.equal(captures, 3);
  assert.deepEqual(
    menu.map((account) => account.userId),
    [alt.user_id, main.user_id],
  );
  assert.equal(plugin.currentUserId, alt.user_id);
});
