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
  plugin.activeTeam = () => ({ teamId: 'T123456' });
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

test('saved accounts are scoped to the current workspace, including old summaries', async () => {
  const all = [
    { userId: 'U123456', teamId: 'THACKCLUB', updatedAt: 1, label: 'Hack Club' },
    { userId: 'U654321', teamId: 'TSANDBOX', enterpriseId: 'ESANDBOX', updatedAt: 2, label: 'Sandbox' },
  ];
  let visible: unknown;
  const plugin = new AccountSwitcher(
    {
      Store: class {
        set(value: unknown) {
          visible = value;
        }
      },
      elements: {},
      main: {
        call: async (method: string) => {
          assert.equal(method, 'list');
          return all;
        },
      },
    },
    {},
  );
  plugin.currentUserId = 'U654321';
  plugin.currentTeamId = 'TSANDBOX';
  plugin.currentEnterpriseId = 'ESANDBOX';
  await plugin.refresh();
  assert.deepEqual(visible, [all[1]]);
  plugin.currentUserId = 'U123456';
  plugin.currentTeamId = 'THACKCLUB';
  plugin.currentEnterpriseId = null;
  await plugin.refresh();
  assert.deepEqual(visible, [all[0]]);
});

test('multi-workspace sessions use scoped members for rows but saved IDs for actions', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  Object.defineProperty(globalThis, 'React', {
    configurable: true,
    value: { createElement: (type: unknown, props: unknown) => ({ type, props }) },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  });
  const a = {
    userId: 'A_RECORD',
    teamId: 'THACKCLUB',
    updatedAt: 1,
    workspaces: {
      THACKCLUB: { userId: 'A_HACK' },
      TONE: { userId: 'A_ONE', enterpriseId: 'EONE' },
      TTWO: { userId: 'A_TWO' },
      TTHREE: { userId: 'A_THREE' },
      TFOUR: { userId: 'A_FOUR' },
    },
  };
  const b = { userId: 'B_RECORD', teamId: 'THACKCLUB', updatedAt: 9, workspaces: { THACKCLUB: { userId: 'B_HACK' } } };
  let visible: (typeof a)[] = [];
  const calls: unknown[][] = [];
  const plugin = new AccountSwitcher(
    {
      Store: class {
        set(value: (typeof a)[]) {
          visible = value;
        }
      },
      elements: {},
      main: {
        call: async (...args: unknown[]) => {
          calls.push(args);
          return args[0] === 'list' ? [b, a] : undefined;
        },
      },
    },
    {},
  );
  plugin.currentTeamId = 'THACKCLUB';
  plugin.currentUserId = 'A_HACK';
  await plugin.refresh();
  assert.deepEqual(visible, [a, b]);
  const menu = plugin.buildSwitcherItem(visible).template;
  assert.equal(menu[0].label.props.userId, 'A_HACK');
  assert.equal(menu[0].label.props.isCurrent, true);
  assert.equal(menu[0].click, undefined);
  assert.equal(menu[1].label.props.userId, 'B_HACK');
  assert.equal(menu[1].label.props.isCurrent, false);
  plugin.captureCurrent = async () => null;
  plugin.activeTeam = () => ({ teamId: 'THACKCLUB' });
  menu[1].click();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), ['switchTo', 'B_RECORD', 'THACKCLUB']);
  let removed: string | undefined;
  plugin.removeAccount = async (id: string) => {
    removed = id;
  };
  menu[1].label.props.onRemove('B_HACK');
  assert.equal(removed, 'B_RECORD');
  for (const [teamId, userId] of [
    ['TONE', 'A_ONE'],
    ['TTWO', 'A_TWO'],
    ['TTHREE', 'A_THREE'],
    ['TFOUR', 'A_FOUR'],
  ]) {
    plugin.currentTeamId = teamId;
    plugin.currentUserId = userId;
    await plugin.refresh();
    assert.deepEqual(visible, [a]);
    const scopedMenu = plugin.buildSwitcherItem(visible).template;
    assert.equal(scopedMenu[0].label.props.userId, userId);
    assert.equal(scopedMenu[0].label.props.isCurrent, true);
    assert.equal(
      scopedMenu.some((item: { label: unknown }) => item.label === 'Other workspaces'),
      false,
    );
  }
});

test('capture includes the full config and recaptures inactive changes and order without adopting the canonical ID', async () => {
  const controller = new AbortController();
  const team = { user_id: 'LIVE', token: 'token' };
  const config = {
    teams: { THACK: team, TOTHER: { user_id: 'OTHER', token: 'other-token' } },
    orderedTeamIds: ['THACK', 'TOTHER'],
    lastActiveTeamId: 'THACK',
    unrelated: 'omit',
  };
  let route = 'THACK';
  const captures: unknown[][] = [];
  const scopes: (string | null)[] = [];
  const plugin = new AccountSwitcher(
    {
      Store: class {
        set() {}
      },
      elements: {},
      signal: controller.signal,
      members: { getCurrentMemberId: () => 'LIVE' },
      main: {
        call: async (...args: unknown[]) => {
          if (args[0] === 'list') {
            scopes.push(plugin.currentTeamId);
            return [];
          }
          captures.push(structuredClone(args));
          return { userId: 'CANONICAL', teamId: 'THACK', updatedAt: 1 };
        },
      },
    },
    {},
  );
  plugin.activeTeam = () => ({
    localConfig: config,
    teamId: route,
    team: config.teams[route as keyof typeof config.teams],
  });
  let tick = 0;
  plugin.delay = async () => {
    assert.equal(plugin.currentUserId, 'LIVE');
    tick++;
    if (tick === 1) config.teams.TOTHER.token = 'rotated';
    if (tick === 2) config.orderedTeamIds.reverse();
    if (tick === 3) config.lastActiveTeamId = 'TOTHER';
    // Same live member, but no matching capture candidate: scope must still move.
    if (tick === 4) route = 'TOTHER';
    if (tick === 6) controller.abort();
  };
  await plugin.captureAndRefresh();
  assert.equal(captures.length, 4);
  assert.deepEqual(captures[0], [
    'capture',
    'THACK',
    team,
    {
      teams: { THACK: team, TOTHER: { user_id: 'OTHER', token: 'other-token' } },
      orderedTeamIds: ['THACK', 'TOTHER'],
      lastActiveTeamId: 'THACK',
    },
  ]);
  assert.equal((captures[1]![3] as typeof config).teams.TOTHER.token, 'rotated');
  assert.deepEqual((captures[2]![3] as typeof config).orderedTeamIds, ['TOTHER', 'THACK']);
  assert.equal((captures[3]![3] as typeof config).lastActiveTeamId, 'TOTHER');
  assert.equal(plugin.currentTeamId, 'TOTHER');
  assert.equal(scopes.at(-1), 'TOTHER');
  assert.equal(plugin.currentUserId, 'LIVE');
  route = 'THACK';
  await plugin.captureCurrent();
  assert.deepEqual(captures.at(-1)?.slice(0, 3), ['capture', 'THACK', team]);
  assert.equal((captures.at(-1)![3] as typeof config).teams.TOTHER.token, 'rotated');
});

test('after SSB the native workspace menu returns to the saved workspace, not the current one', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  const createElement = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({
    type,
    key: props?.key ?? null,
    props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) },
  });
  Object.defineProperty(globalThis, 'React', {
    configurable: true,
    value: {
      createElement,
      cloneElement: (source: { type: unknown; props: Record<string, unknown> }, props: Record<string, unknown>) =>
        createElement(source.type, { ...source.props, ...props }),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  });
  const patches = new Map<
    string,
    (props: Record<string, unknown>) => { props: { children: { key: string; props: { onSelected?: () => void } }[] } }
  >();
  const calls: unknown[][] = [];
  const hack = {
    userId: 'UHACK00',
    teamId: 'EHACK00',
    updatedAt: 1,
    workspaces: { EHACK00: { userId: 'UHACK00', name: 'Hack Club' } },
  };
  const sandbox = {
    userId: 'USAND00',
    teamId: 'ESAND00',
    updatedAt: 2,
    workspaces: { ESAND00: { userId: 'USAND00', name: 'Sandbox' } },
  };
  const plugin = new AccountSwitcher(
    {
      loader: 'desktop',
      Store: class {
        value: unknown;
        constructor(value: unknown) {
          this.value = value;
        }
        set(value: unknown) {
          this.value = value;
        }
        use() {
          return this.value;
        }
      },
      elements: {},
      members: {},
      main: {
        on() {},
        call: async (...args: unknown[]) => {
          calls.push(args);
          return args[0] === 'list' ? [hack, sandbox] : undefined;
        },
      },
      patchComponent: (name: string, patch: (original: unknown) => unknown) =>
        patches.set(name, patch('Original') as never),
    },
    {},
  );
  plugin.captureAndRefresh = async () => {};
  plugin.captureCurrent = async () => null;
  plugin.activeTeam = () => ({ teamId: 'ESAND00' });
  plugin.currentTeamId = 'ESAND00';
  plugin.currentUserId = 'USAND00';
  plugin.start();
  await plugin.refresh();
  assert.deepEqual(plugin.accountsStore.value, [sandbox]); // account menu remains scoped
  const original = [
    {
      type: 'MenuItem',
      key: 'ESAND00',
      props: {
        onSelected: () => {
          throw Error('native');
        },
      },
    },
    {
      type: 'MenuItem',
      key: 'team_switcher_add',
      props: {
        onSelected: () => {
          throw Error('add');
        },
      },
    },
  ];
  const menu = patches.get('Menu')!({ menuClassNames: 'p-team_switcher_menu p-peek_card', children: original });
  const savedRow = menu.props.children.find((row) => row.key === 'slick-saved-workspace__EHACK00')!;
  assert.ok(savedRow);
  assert.equal(menu.props.children[0], original[0]);
  assert.equal(menu.props.children.at(-1), original[1]);
  savedRow.props.onSelected!();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), ['switchTo', 'UHACK00', 'EHACK00']);
  const unrelated = patches.get('Menu')!({ menuClassNames: 'some-other-menu', children: original });
  assert.equal(unrelated.props.children, original);
});
