import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureCandidate, scopedMemberId, workspaceSnapshot } from './session.ts';

const teamId = 'T123456';
const main = { user_id: 'U123456', token: 'main-token' };
const alt = { user_id: 'U654321', token: 'test-token' };

test('redirect login does not capture localConfig from the previous account', () => {
  const config = { teams: { [teamId]: main } };
  assert.equal(captureCandidate(config, teamId, alt.user_id), null);
  config.teams[teamId] = alt;
  assert.equal(captureCandidate(config, teamId, alt.user_id), alt);
});

test('capture waits for the live identity and matching credentials', () => {
  const config = { teams: { [teamId]: main } };
  assert.equal(captureCandidate(config, teamId, undefined), null);
  assert.equal(captureCandidate(config, 'T654321', main.user_id), null);
  assert.equal(captureCandidate({ teams: { [teamId]: { ...main, token: '' } } }, teamId, main.user_id), null);
  assert.equal(captureCandidate(config, teamId, main.user_id), main);
});

test('scope prefers exact members over enterprise matches and only falls back for old summaries', () => {
  const account = {
    userId: 'RECORD',
    teamId: 'TPRIMARY',
    enterpriseId: 'EGRID',
    updatedAt: 1,
    workspaces: {
      TPRIMARY: { userId: 'PRIMARY', enterpriseId: 'EGRID' },
      TEXACT: { userId: 'EXACT', enterpriseId: 'EGRID' },
    },
  };
  assert.equal(scopedMemberId(account, 'TEXACT', 'EGRID'), 'EXACT');
  assert.equal(scopedMemberId(account, 'TSIBLING', 'EGRID'), undefined);
  assert.equal(scopedMemberId(account, 'EGRID', 'EGRID'), 'PRIMARY');
  assert.equal(scopedMemberId(account, 'TOTHER', null), undefined);
  assert.equal(scopedMemberId(account, null, 'EGRID'), undefined);
  assert.equal(scopedMemberId({ ...account, workspaces: {} }, 'TPRIMARY', 'EGRID'), undefined);
  const legacy = { ...account, workspaces: undefined };
  assert.equal(scopedMemberId(legacy, 'TPRIMARY', null), 'RECORD');
  assert.equal(scopedMemberId(legacy, 'TSIBLING', 'EGRID'), undefined);
  assert.equal(scopedMemberId(legacy, 'EGRID', 'EGRID'), 'RECORD');
  assert.equal(scopedMemberId(legacy, 'TOTHER', null), undefined);
});

test('workspace snapshot includes every team, order and last-active ID but no unrelated config', () => {
  const config = {
    teams: { T123456: main, T654321: alt },
    orderedTeamIds: ['T654321', 'T123456'],
    lastActiveTeamId: 'T654321',
    unrelated: true,
  };
  assert.deepEqual(workspaceSnapshot(config), {
    teams: config.teams,
    orderedTeamIds: config.orderedTeamIds,
    lastActiveTeamId: config.lastActiveTeamId,
  });
});
