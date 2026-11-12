import assert from 'node:assert/strict';
import { test } from 'node:test';
import { userAPI } from './userAPI.ts';

const enterprise = {
  id: 'E1',
  user_id: 'U1',
  token: 'xoxc-enterprise',
  url: 'https://example.enterprise.slack.com/',
};
const workspace = {
  id: 'T1',
  user_id: 'U1',
  token: 'xoxc-workspace',
  url: 'https://example.slack.com/',
  enterprise_id: 'E1',
};

function withSlack(teams: Record<string, object>, responses: object[]) {
  const globals = globalThis as any;
  const previous = { localStorage: globals.localStorage, location: globals.location, fetch: globals.fetch };
  const requests: { host: string; token: FormDataEntryValue | null }[] = [];
  globals.localStorage = { getItem: () => JSON.stringify({ teams }) };
  globals.location = { pathname: '/client/E1/C1' };
  globals.fetch = async (url: string, init: RequestInit) => {
    requests.push({ host: new URL(url).host, token: (init.body as FormData).get('token') });
    return Response.json(responses[requests.length - 1] ?? { ok: false, error: 'unexpected_request' });
  };
  return {
    requests,
    restore() {
      Object.assign(globals, previous);
    },
  };
}

test('userAPI retries an enterprise-restricted call once with the same login’s workspace token', async () => {
  const slack = withSlack({ E1: enterprise, T1: workspace }, [
    { ok: false, error: 'enterprise_is_restricted' },
    { ok: true, members: ['U2'] },
  ]);
  try {
    const response = await userAPI<{ members: string[] }>('conversations.members', { channel: 'C1' });
    assert.deepEqual(response.members, ['U2']);
    assert.deepEqual(slack.requests, [
      { host: 'example.enterprise.slack.com', token: 'xoxc-enterprise' },
      { host: 'example.slack.com', token: 'xoxc-workspace' },
    ]);
  } finally {
    slack.restore();
  }
});

test('userAPI does not switch tokens for other errors, other logins or a second refusal', async () => {
  const cases: [Record<string, object>, object[], number][] = [
    [{ E1: enterprise, T1: workspace }, [{ ok: false, error: 'invalid_auth' }], 1],
    [{ E1: enterprise, T1: { ...workspace, user_id: 'U9' } }, [{ ok: false, error: 'enterprise_is_restricted' }], 1],
    [
      { E1: enterprise, T1: workspace },
      [
        { ok: false, error: 'enterprise_is_restricted' },
        { ok: false, error: 'enterprise_is_restricted' },
      ],
      2,
    ],
  ];
  for (const [teams, responses, calls] of cases) {
    const slack = withSlack(teams, responses);
    try {
      await assert.rejects(userAPI('conversations.members', { channel: 'C1' }), /failed/);
      assert.equal(slack.requests.length, calls);
    } finally {
      slack.restore();
    }
  }
});
