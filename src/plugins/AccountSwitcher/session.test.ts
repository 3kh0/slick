import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureCandidate } from './session.ts';

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
