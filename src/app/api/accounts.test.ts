import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { applyPendingAccountSwitch, PENDING_ACCOUNT_SWITCH_KEY, stageAccountRemoval } from './accounts.ts';

function storage(t: TestContext) {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  return values;
}

const teamId = 'T123456';
const otherId = 'T654321';
const config = {
  teams: { [teamId]: { token: 'old-token', user_id: 'U123456' }, [otherId]: { token: 'other-token' } },
  orderedTeamIds: [teamId, otherId],
  lastActiveTeamId: teamId,
  unrelated: true,
};

test('switch handoff restores the whole saved workspace after Slack flushes its old state', (t) => {
  const values = storage(t);
  const team = {
    token: 'new-token',
    user_id: 'U654321',
    url: 'https://enterprise.slack.com/',
    enterprise_id: 'E123456',
  };
  values.set(PENDING_ACCOUNT_SWITCH_KEY, JSON.stringify({ userId: team.user_id, teamId, team }));
  // Slack's unload handler overwrites localConfig with the account we are leaving.
  values.set('localConfig_v2', JSON.stringify(config));
  applyPendingAccountSwitch();
  assert.deepEqual(JSON.parse(values.get('localConfig_v2')!), {
    ...config,
    teams: { [teamId]: team },
    orderedTeamIds: [teamId],
  });
  assert.equal(values.has(PENDING_ACCOUNT_SWITCH_KEY), false);
  values.set('localConfig_v2', JSON.stringify(config));
  applyPendingAccountSwitch();
  assert.deepEqual(JSON.parse(values.get('localConfig_v2')!), config);
});

test('add-account handoff removes the old workspace after unload without removing other workspaces', (t) => {
  const values = storage(t);
  values.set('localConfig_v2', JSON.stringify(config));
  stageAccountRemoval(teamId);
  assert.deepEqual(JSON.parse(values.get('localConfig_v2')!), config);
  values.set('localConfig_v2', JSON.stringify(config));
  applyPendingAccountSwitch();
  assert.deepEqual(JSON.parse(values.get('localConfig_v2')!), {
    teams: { [otherId]: config.teams[otherId] },
    orderedTeamIds: [otherId],
    unrelated: true,
  });
  assert.equal(values.has(PENDING_ACCOUNT_SWITCH_KEY), false);
});

test('removing an account preserves a different active workspace', (t) => {
  const values = storage(t);
  values.set('localConfig_v2', JSON.stringify({ ...config, lastActiveTeamId: otherId }));
  stageAccountRemoval(teamId);
  applyPendingAccountSwitch();
  assert.equal(JSON.parse(values.get('localConfig_v2')!).lastActiveTeamId, otherId);
});

test('switch adds a missing workspace to the active order exactly once', (t) => {
  const values = storage(t);
  const account = { teamId, team: { token: 'new-token', user_id: 'U123456' } };
  values.set('localConfig_v2', '{}');
  for (let i = 0; i < 2; i++) {
    values.set(PENDING_ACCOUNT_SWITCH_KEY, JSON.stringify(account));
    applyPendingAccountSwitch();
  }
  const result = JSON.parse(values.get('localConfig_v2')!);
  assert.deepEqual(result.orderedTeamIds, [teamId]);
  assert.equal(result.lastActiveTeamId, teamId);
  assert.deepEqual(result.teams[teamId], account.team);
});

test('strict preload handoff retains its marker and fails closed if config storage fails', (t) => {
  const values = storage(t);
  const pending = JSON.stringify({ teamId, team: { token: 'new-token', user_id: 'U123456' } });
  values.set(PENDING_ACCOUNT_SWITCH_KEY, pending);
  values.set('localConfig_v2', JSON.stringify(config));
  t.mock.method(localStorage, 'setItem', () => {
    throw new Error('quota exceeded');
  });
  assert.throws(() => applyPendingAccountSwitch(true), /quota exceeded/);
  assert.equal(values.get(PENDING_ACCOUNT_SWITCH_KEY), pending);
  assert.deepEqual(JSON.parse(values.get('localConfig_v2')!), config);
});

test('invalid handoffs do not alter Slack configuration', (t) => {
  const values = storage(t);
  t.mock.method(console, 'warn', () => {});
  for (const pending of ['invalid json', 'null', '{}', JSON.stringify({ teamId, team: { token: '' } })]) {
    values.set('localConfig_v2', JSON.stringify(config));
    values.set(PENDING_ACCOUNT_SWITCH_KEY, pending);
    applyPendingAccountSwitch();
    assert.deepEqual(JSON.parse(values.get('localConfig_v2')!), config);
    assert.equal(values.has(PENDING_ACCOUNT_SWITCH_KEY), false);
  }
  assert.throws(() => stageAccountRemoval('../bad'), /bad team id/);
});
