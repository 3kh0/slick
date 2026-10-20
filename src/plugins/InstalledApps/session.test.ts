import assert from 'node:assert/strict';
import test from 'node:test';
import { appSessions, sessionRequest } from './session.ts';

const active = { id: 'E123', user_id: 'U123', token: 'enterprise', url: 'https://example.enterprise.slack.com' };
const workspace = {
  id: 'T123',
  enterprise_id: 'E123',
  user_id: 'U123',
  token: 'workspace',
  url: 'https://example.slack.com',
};

test('fallback stays within the same user and enterprise', () => {
  assert.deepEqual(
    appSessions(active, {
      teams: {
        active,
        workspace,
        otherUser: { ...workspace, id: 'T456', user_id: 'U456' },
        otherOrg: { ...workspace, id: 'T789', enterprise_id: 'E456' },
      },
    }),
    [active, workspace],
  );
});

test('enterprise restriction falls back with workspace token and unchanged user filter', async () => {
  const requests: { host: string; token: FormDataEntryValue | null; user: FormDataEntryValue | null }[] = [];
  const request: typeof fetch = async (url, init) => {
    const body = init!.body as FormData;
    requests.push({ host: new URL(String(url)).host, token: body.get('token'), user: body.get('user_id') });
    return Response.json(
      requests.length === 1 ? { ok: false, error: 'enterprise_is_restricted' } : { ok: true, apps: [] },
    );
  };
  await sessionRequest([active, workspace], { user_id: 'U999' }, new AbortController().signal, request);
  assert.deepEqual(requests, [
    { host: 'example.enterprise.slack.com', token: 'enterprise', user: 'U999' },
    { host: 'example.slack.com', token: 'workspace', user: 'U999' },
  ]);
});

test('does not retry revoked authentication, rate limits, or network errors with another token', async () => {
  for (const error of ['invalid_auth', 'ratelimited']) {
    let calls = 0;
    await assert.rejects(
      sessionRequest([active, workspace], {}, new AbortController().signal, async () => {
        calls++;
        return Response.json({ ok: false, error });
      }),
      new RegExp(error),
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    sessionRequest([{ ...active, url: 'https://example.org' }], {}, new AbortController().signal, async () => {
      throw Error('must not send');
    }),
    /Invalid Slack host/,
  );
});

test('remembers the successful session so subsequent people and pages skip the rejected enterprise request', async () => {
  const choice = {};
  let calls = 0;
  const request: typeof fetch = async (_url, init) => {
    calls++;
    return Response.json(
      (init!.body as FormData).get('token') === 'enterprise'
        ? { ok: false, error: 'enterprise_is_restricted' }
        : { ok: true, apps: [] },
    );
  };
  const signal = new AbortController().signal;
  await sessionRequest([active, workspace], { user_id: 'U123' }, signal, request, choice);
  assert.equal(calls, 2);
  await sessionRequest([active, workspace], { user_id: 'U456' }, signal, request, choice);
  assert.equal(calls, 3);
  // A remembered ID cannot introduce a workspace absent from the current session's candidates.
  await assert.rejects(sessionRequest([active], {}, signal, request, choice), /enterprise_is_restricted/);
});
