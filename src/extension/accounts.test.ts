import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createAccountService,
  ACCOUNT_BARRIER_ID,
  readAccountContext,
  type AccountBrowser,
  type AccountCookie,
  type AccountState,
  type AccountTab,
} from './accounts.ts';
import { createBackground } from './background.ts';
import { SETTINGS_KEY } from './storage.ts';
import { validRequest } from './rpc.ts';

const teamA = { user_id: 'U111111', token: 'token-a', url: 'https://example.slack.com/', enterprise_id: 'E111111' };
const teamB = { ...teamA, user_id: 'U222222', token: 'token-b' };
const configA = JSON.stringify({ teams: { T111111: teamA }, orderedTeamIds: ['T111111'], lastActiveTeamId: 'T111111' });
const cookie = (value: string): AccountCookie => ({
  name: 'd',
  value,
  domain: '.slack.com',
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
});

function fixture(firefox = false) {
  let stored: AccountState = {
    accounts: [{ userId: teamB.user_id, teamId: 'T111111', updatedAt: 1, team: teamB, cookies: [cookie('cookie-b')] }],
  };
  let jar = [cookie('cookie-a')];
  let config: string | null = configA;
  let granted = true;
  let mismatch = false;
  const events: string[] = [];
  const tabs = new Map<number, AccountTab>([
    [1, { id: 1, url: 'https://app.slack.com/client/T111111', status: 'complete' }],
    [2, { id: 2, url: 'https://app.slack.com/client/T111111/C111111', status: 'complete' }],
    [3, { id: 3, url: 'https://unrelated.example/', status: 'complete' }],
    [
      4,
      { id: 4, url: 'https://app.slack.com/client/T222222', cookieStoreId: 'firefox-container-1', status: 'complete' },
    ],
  ]);
  const rules = new Map<number, any>();
  const cleared: any[] = [];
  const area = {
    get: async () => ({ [SETTINGS_KEY]: JSON.stringify({ plugins: { AccountSwitcher: { enabled: true } } }) }),
    set: async () => {},
    remove: async () => {},
  };
  const api = {
    runtime: { id: 'test', getURL: (path: string) => `${firefox ? 'moz' : 'chrome'}-extension://test/${path}` },
    storage: { local: area, onChanged: { addListener() {} } },
    permissions: { contains: async () => granted },
    cookies: {
      getAll: async () => structuredClone(jar),
      remove: async ({ name }: any) => {
        events.push('cookie.remove');
        jar = jar.filter((c) => c.name !== name);
      },
      set: async (value: AccountCookie & { url: string }) => {
        events.push('cookie.set');
        assert.ok(rules.has(ACCOUNT_BARRIER_ID), 'cookie swap must be behind the request barrier');
        assert.ok(
          [...tabs.values()]
            .filter((t) => [1, 2].includes(t.id!))
            .every((t) => t.url?.endsWith('accounts-paused.html')),
          'every client must unload before cookies change',
        );
        const saved = { ...value };
        Reflect.deleteProperty(saved, 'url');
        jar.push(saved);
        return saved;
      },
    },
    tabs: {
      query: async ({ url }: any) =>
        [...tabs.values()].filter((t) => !url || t.url?.startsWith('https://app.slack.com/client')),
      get: async (id: number) => {
        if (!tabs.has(id)) throw new Error('closed');
        return structuredClone(tabs.get(id)!);
      },
      update: async (id: number, value: any) => {
        if (!tabs.has(id)) throw new Error('closed');
        events.push('navigate:' + value.url);
        const updated = { ...tabs.get(id), ...value, status: 'complete' };
        tabs.set(id, updated);
        return updated;
      },
      create: async ({ url }: any) => {
        const id = Math.max(...tabs.keys()) + 1;
        const tab = { id, url, status: 'complete' };
        tabs.set(id, tab);
        return tab;
      },
    },
    scripting: {
      executeScript: async ({ func, args }: any) => {
        if (func === readAccountContext) {
          const parsed = config ? JSON.parse(config) : null;
          return [
            {
              result: parsed
                ? { teamId: parsed.lastActiveTeamId, team: parsed.teams[parsed.lastActiveTeamId], config }
                : null,
            },
          ];
        }
        events.push('context.write');
        config = args[0];
        return [{ result: null }];
      },
    },
    browsingData: {
      remove: async (options: any, types: any) => {
        events.push('cache.clear');
        cleared.push({ options, types });
        config = null;
      },
    },
    declarativeNetRequest: {
      getSessionRules: async () => [...rules.values()],
      updateSessionRules: async ({ removeRuleIds, addRules }: any) => {
        for (const id of removeRuleIds) rules.delete(id);
        for (const rule of addRules ?? []) rules.set(rule.id, rule);
      },
    },
  } as unknown as AccountBrowser;
  const vault = {
    read: async () => structuredClone(stored),
    write: async (value: AccountState) => {
      events.push('vault.write');
      stored = structuredClone(value);
    },
  };
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    events.push('auth.test');
    const token = new URLSearchParams(String(init.body)).get('token');
    const matched =
      (token === teamA.token && jar[0]?.value === 'cookie-a') ||
      (token === teamB.token && jar[0]?.value === 'cookie-b');
    const stale = jar.some((c) => c.name === 'uc' && c.value === 'stale-companion');
    return new Response(
      JSON.stringify({
        ok: matched && !mismatch && !stale,
        error: 'invalid_auth',
        user_id: token === teamA.token ? teamA.user_id : teamB.user_id,
      }),
    );
  }) as typeof fetch;
  return {
    api,
    vault,
    events,
    tabs,
    rules,
    cleared,
    fetcher,
    service: createAccountService(api, vault, fetcher),
    state: () => stored,
    config: () => config,
    jar: () => jar,
    setState(value: AccountState) {
      stored = structuredClone(value);
    },
    grant(value: boolean) {
      granted = value;
    },
    mismatch(value: boolean) {
      mismatch = value;
    },
  };
}

test('capture verifies the cookie/token pair and returns summaries without credentials', async () => {
  const f = fixture();
  const saved = await f.service.capture('1', 'Personal');
  assert.equal(saved.userId, teamA.user_id);
  assert.equal(saved.label, 'Personal');
  const publicData = JSON.stringify(await f.service.list());
  assert.ok(!publicData.includes('token-') && !publicData.includes('cookie-'));
  assert.equal(f.jar()[0].value, 'cookie-a');
  assert.ok(!f.events.some((e) => e.startsWith('navigate:')));
  assert.equal(f.state().accounts.length, 2);
});

test('switch parks every client, verifies only the saved pair and boots one target configuration', async () => {
  const f = fixture();
  await f.service.switchTo(teamB.user_id, '1');
  assert.equal(f.jar()[0].value, 'cookie-b');
  assert.deepEqual(JSON.parse(f.config()!).teams, { T111111: teamB });
  assert.equal(f.tabs.get(1)?.url, 'https://app.slack.com/client/T111111');
  assert.equal(f.tabs.get(2)?.url, 'https://app.slack.com/client/T111111');
  assert.equal(f.tabs.get(3)?.url, 'https://unrelated.example/');
  assert.equal(f.tabs.get(4)?.url, 'https://app.slack.com/client/T222222');
  assert.equal(f.rules.has(ACCOUNT_BARRIER_ID), false);
  assert.equal(f.state().journal, undefined);
  assert.ok(f.events.indexOf('vault.write') < f.events.indexOf('cookie.remove'));
  assert.deepEqual(f.cleared[0].options, { origins: ['https://app.slack.com'] });
});

test('rejected target rolls back the original cookies/config and reopens original routes', async () => {
  const f = fixture();
  f.mismatch(true);
  await assert.rejects(f.service.switchTo(teamB.user_id, ''), /Slack rejected/);
  assert.equal(f.jar()[0].value, 'cookie-a');
  assert.equal(f.config(), configA);
  assert.equal(f.tabs.get(2)?.url, 'https://app.slack.com/client/T111111/C111111');
  assert.equal(f.state().journal, undefined);
  assert.equal(f.rules.has(ACCOUNT_BARRIER_ID), false);
});

test('stale companions retry only the saved primary cookie/token pair', async () => {
  const f = fixture();
  const state = structuredClone(f.state());
  state.accounts[0].cookies.push({ ...cookie('stale-companion'), name: 'uc' });
  f.setState(state);
  await f.service.switchTo(teamB.user_id, '');
  assert.deepEqual(
    f.jar().map((c) => [c.name, c.value]),
    [['d', 'cookie-b']],
  );
  assert.deepEqual(
    f.state().accounts[0].cookies.map((c) => c.name),
    ['d'],
  );
  assert.equal(f.events.filter((e) => e === 'auth.test').length, 2);
});

test('worker recovery restores an uncommitted session before lifting the barrier', async () => {
  const f = fixture();
  f.setState({
    ...f.state(),
    journal: {
      tabs: [{ id: 1, url: 'https://app.slack.com/client/T111111' }],
      cookies: [cookie('cookie-a')],
      config: configA,
    },
  });
  f.tabs.get(1)!.url = f.api.runtime.getURL('accounts-paused.html');
  await createAccountService(f.api, f.vault, f.fetcher).recover();
  assert.equal(f.config(), configA);
  assert.equal(f.jar()[0].value, 'cookie-a');
  assert.equal(f.tabs.get(1)?.url, 'https://app.slack.com/client/T111111');
  assert.equal(f.state().journal, undefined);
});

for (const firefox of [false, true]) {
  test(`worker recovery journals new Slack tabs before pausing them (${firefox ? 'Firefox' : 'Chromium'})`, async () => {
    const f = fixture(firefox);
    const originalRoute = 'https://app.slack.com/client/T111111/C555555';
    f.setState({
      ...f.state(),
      journal: {
        tabs: [{ id: 1, url: 'https://app.slack.com/client/T111111' }],
        cookies: [cookie('cookie-a')],
        config: configA,
      },
    });
    f.tabs.get(1)!.url = f.api.runtime.getURL('accounts-paused.html');
    f.tabs.set(5, { id: 5, url: originalRoute, status: 'complete' });
    const update = f.api.tabs.update;
    let interrupted = false;
    f.api.tabs.update = async (id, value) => {
      if (id === 5 && !interrupted) {
        assert.deepEqual(
          f.state().journal?.tabs.find((tab) => tab.id === 5),
          { id: 5, url: originalRoute },
        );
        await update(id, value);
        interrupted = true;
        throw new Error('Worker interrupted after pausing a new tab');
      }
      return update(id, value);
    };
    await assert.rejects(f.service.recover(), /Worker interrupted/);
    await createAccountService(f.api, f.vault, f.fetcher).recover();
    assert.equal(f.tabs.get(1)?.url, 'https://app.slack.com/client/T111111');
    assert.equal(f.tabs.get(2)?.url, 'https://app.slack.com/client/T111111/C111111');
    assert.equal(f.tabs.get(5)?.url, originalRoute);
    assert.equal(f.tabs.get(3)?.url, 'https://unrelated.example/');
    assert.equal(f.tabs.get(4)?.url, 'https://app.slack.com/client/T222222');
    assert.equal(f.state().journal, undefined);
    assert.equal(f.rules.has(ACCOUNT_BARRIER_ID), false);
  });
}

test('adding an account saves the current session then opens a clean sign-in while other tabs stay paused', async () => {
  const f = fixture(true);
  await f.service.add('1');
  assert.equal(f.jar().length, 0);
  assert.equal(f.config(), null);
  assert.ok(f.state().accounts.some((a) => a.userId === teamA.user_id));
  assert.equal(f.tabs.get(1)?.url, 'https://app.slack.com/signin');
  assert.equal(f.tabs.get(2)?.url, 'moz-extension://test/accounts-paused.html');
  assert.deepEqual(f.cleared[0], {
    options: { hostnames: ['app.slack.com'], cookieStoreId: 'firefox-default' },
    types: { localStorage: true, indexedDB: true },
  });
});

test('permission denial and private/container captures do not change sessions', async () => {
  const f = fixture();
  f.grant(false);
  await assert.rejects(f.service.capture('1'), /grant Slack session access/);
  await assert.rejects(f.service.switchTo(teamB.user_id, ''), /grant Slack session access/);
  assert.deepEqual(f.events, []);
  f.grant(true);
  await assert.rejects(f.service.capture('4'), /normal browser tabs/);
  f.tabs.get(1)!.incognito = true;
  await assert.rejects(f.service.capture('1'), /normal browser tabs/);
  assert.equal(f.jar()[0].value, 'cookie-a');
});

test('forget deletes saved credentials without changing the active cookie jar', async () => {
  const f = fixture();
  f.grant(false);
  await f.service.forget(teamB.user_id);
  assert.deepEqual(await f.service.list(), []);
  assert.equal(f.jar()[0].value, 'cookie-a');
});

test('forged Slack requests cannot capture, delete, switch or access trusted account status', async () => {
  const f = fixture();
  const dispatch = createBackground(f.api, [], undefined, f.service);
  const page = { id: 'test', frameId: 0, tab: { id: 1 }, url: 'https://app.slack.com/client/T111111' };
  const methods = [
    { method: 'account.capture', args: ['1'] },
    { method: 'account.switch', args: [teamB.user_id, '1'] },
    { method: 'account.forget', args: [teamB.user_id] },
    { method: 'account.add', args: ['1'] },
    { method: 'account.status', args: [] },
    { method: 'account.recover', args: [] },
  ];
  for (const request of methods) {
    assert.equal(validRequest(request), true);
    assert.equal((await dispatch(request, page)).ok, false);
    assert.equal((await dispatch(request, { id: 'test', url: 'chrome-extension://test/options.html' })).ok, false);
  }
  const response = await dispatch({ method: 'account.list', args: [] }, page);
  assert.equal(response.ok, true);
  assert.ok(!JSON.stringify(response).includes('token-') && !JSON.stringify(response).includes('cookie-'));
  assert.equal(
    (
      await dispatch(
        { method: 'account.status', args: [] },
        { id: 'test', url: 'chrome-extension://test/accounts.html' },
      )
    ).ok,
    true,
  );
  assert.equal(f.jar()[0].value, 'cookie-a');
});

test('account request shapes cannot smuggle a URL, token or arbitrary cookie operation', () => {
  for (const request of [
    { method: 'account.capture', args: ['https://evil.example'] },
    { method: 'account.capture', args: ['1', 'x'.repeat(81)] },
    { method: 'account.switch', args: [teamB.user_id, '1', 'cookie-b'] },
    { method: 'account.open', args: ['javascript:alert(1)'] },
    { method: 'account.cookies', args: [] },
  ])
    assert.equal(validRequest(request), false);
});
