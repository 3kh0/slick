import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  callWithFallback,
  candidateTeams,
  postSlackMethod,
  readLocalConfigTeams,
  routeTeamId,
  SlackApiError,
  type TeamCredential,
} from '../slackApi.ts';

const team = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  token: `xoxc-${id}`,
  url: `https://${id.toLowerCase()}.slack.com/`,
  user_id: `U-${id}`,
  ...extra,
});

describe('routeTeamId', () => {
  it('reads the workspace or org id from a /client route', () => {
    assert.equal(routeTeamId('/client/E09V59WQY1E/C06V73WGACB'), 'E09V59WQY1E');
    assert.equal(routeTeamId('/client/T0266FRGM'), 'T0266FRGM');
  });

  it('returns undefined off the client routes', () => {
    assert.equal(routeTeamId('/messages/general'), undefined);
    assert.equal(routeTeamId('/client/../evil'), undefined);
  });
});

describe('readLocalConfigTeams', () => {
  it('returns no teams for missing or corrupt localConfig', () => {
    assert.deepEqual(readLocalConfigTeams({ getItem: () => null }), {});
    assert.deepEqual(readLocalConfigTeams({ getItem: () => '{not json' }), {});
  });
});

describe('candidateTeams', () => {
  it('on an org route, tries its workspaces (by id) before the org token', () => {
    const teams = {
      E1: team('E1'),
      T2: team('T2', { enterprise_id: 'E1' }),
      T1: team('T1', { enterprise_id: 'E1' }),
      T9: team('T9'),
    };
    assert.deepEqual(
      candidateTeams(teams, 'E1').map((entry) => entry.id),
      ['T1', 'T2', 'E1'],
    );
  });

  it('on a workspace route, uses only that workspace', () => {
    const teams = { T1: team('T1'), T2: team('T2') };
    assert.deepEqual(
      candidateTeams(teams, 'T2').map((entry) => entry.id),
      ['T2'],
    );
  });

  it('skips teams without a token or with a non-Slack URL', () => {
    const teams = {
      E1: team('E1', { token: '' }),
      T1: team('T1', { enterprise_id: 'E1', url: 'https://evil.example/' }),
      T2: team('T2', { enterprise_id: 'E1' }),
    };
    assert.deepEqual(
      candidateTeams(teams, 'E1').map((entry) => entry.id),
      ['T2'],
    );
  });

  it('returns nothing without a route', () => {
    assert.deepEqual(candidateTeams({ T1: team('T1') }, undefined), []);
  });
});

const credential = (id: string): TeamCredential => ({
  id,
  token: `xoxc-${id}`,
  url: `https://${id.toLowerCase()}.slack.com/`,
  userId: `U-${id}`,
});

describe('postSlackMethod', () => {
  it('posts the token and params as a form to the team host with credentials and keepalive', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ ok: true, value: 1 }));
    }) as typeof fetch;
    const result = await postSlackMethod<{ value: number }>(
      credential('T1'),
      'rooms.leave',
      { room_id: 'R1' },
      { keepalive: true, fetcher },
    );
    assert.equal(result.value, 1);
    assert.equal(seen?.url, 'https://t1.slack.com/api/rooms.leave?_x_gantry=true');
    assert.equal(seen?.init.credentials, 'include');
    assert.equal(seen?.init.keepalive, true);
    const body = seen?.init.body as FormData;
    assert.equal(body.get('token'), 'xoxc-T1');
    assert.equal(body.get('room_id'), 'R1');
  });

  it('turns ok:false into a SlackApiError with Slack’s error code', async () => {
    const fetcher = (async () => new Response(JSON.stringify({ ok: false, error: 'not_in_channel' }))) as typeof fetch;
    await assert.rejects(
      postSlackMethod(credential('T1'), 'rooms.join', {}, { fetcher }),
      (error: unknown) => error instanceof SlackApiError && error.code === 'not_in_channel',
    );
  });

  it('reports HTTP failures with the status', async () => {
    const fetcher = (async () => new Response('down', { status: 503 })) as typeof fetch;
    await assert.rejects(postSlackMethod(credential('T1'), 'rooms.join', {}, { fetcher }), /HTTP 503/);
  });
});

describe('callWithFallback', () => {
  it('falls back to the next token when Slack refuses one, and says which worked', async () => {
    const tried: string[] = [];
    const post = (async (target: TeamCredential, method: string) => {
      tried.push(target.id);
      if (target.id === 'T1') throw new SlackApiError(method, 'not_allowed_token_type');
      return { ok: true };
    }) as typeof postSlackMethod;
    const { team: used } = await callWithFallback([credential('T1'), credential('E1')], 'rooms.join', {}, post);
    assert.deepEqual(tried, ['T1', 'E1']);
    assert.equal(used.id, 'E1');
  });

  it('stops at a network failure instead of retrying every token', async () => {
    const tried: string[] = [];
    const post = (async (target: TeamCredential) => {
      tried.push(target.id);
      throw new TypeError('Failed to fetch');
    }) as typeof postSlackMethod;
    await assert.rejects(
      callWithFallback([credential('T1'), credential('E1')], 'rooms.join', {}, post),
      /Failed to fetch/,
    );
    assert.deepEqual(tried, ['T1']);
  });

  it('rethrows the last refusal when every token is refused', async () => {
    const post = (async (target: TeamCredential, method: string) => {
      throw new SlackApiError(method, `refused_${target.id}`);
    }) as typeof postSlackMethod;
    await assert.rejects(callWithFallback([credential('T1'), credential('E1')], 'rooms.join', {}, post), /refused_E1/);
  });

  it('explains when there is no token at all', async () => {
    await assert.rejects(callWithFallback([], 'rooms.join', {}), /Couldn't find a Slack token/);
  });
});
