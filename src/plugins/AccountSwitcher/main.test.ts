import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MainCtx } from '../../shared/main.ts';
import plugin from './main.ts';

function fixture() {
  let secret: string | null = null;
  const writes: Electron.CookiesSetDetails[] = [];
  const removed: string[] = [];
  const requests: { url: string; init?: RequestInit }[] = [];
  const ctx = {
    net: {
      fetch: async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return { status: 200, body: JSON.stringify({ ok: true, user_id: 'U123456' }) };
      },
    },
    sessions: {
      navigate: async (_sender: unknown, _url: string, _pending: unknown, mutate: () => Promise<void>) => mutate(),
      onSignIn: () => () => {},
    },
    cookies: {
      get: async () => ({ value: 'saved-session' }),
      set: async (details: Electron.CookiesSetDetails) => void writes.push(details),
      remove: async (_url: string, name: string) => void removed.push(name),
    },
    secrets: {
      read: async () => secret,
      write: async (_key: string, value: string) => {
        secret = value;
        return true;
      },
    },
  } as unknown as MainCtx;
  const call = async (method: string, ...args: unknown[]) =>
    plugin.rpc![method]!(ctx, args, {} as Electron.WebContents);
  return { ctx, call, writes, removed, requests };
}

const teamId = 'T123456';
const team = {
  user_id: 'U123456',
  token: 'saved-token',
  url: 'https://enterprise.slack.com/',
  enterprise_id: 'E123456',
};

test('capture and switch restore the matching cookie and complete enterprise team entry', async () => {
  const { call, writes, requests } = fixture();
  await call('capture', teamId, team);
  const result = await call('switchTo', team.user_id);
  assert.equal(requests[0]!.url, 'https://enterprise.slack.com/api/auth.test');
  assert.equal(new Headers(requests[0]!.init!.headers).get('Cookie'), 'd=saved-session');
  assert.equal(requests[0]!.init!.body, 'token=saved-token');
  assert.deepEqual(result, { userId: team.user_id, teamId, team });
  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.value, 'saved-session');
  assert.equal(writes[0]!.name, 'd');
  assert.equal(writes[0]!.httpOnly, true);
});

test('expired saved credentials leave the live session untouched and keep the saved account', async () => {
  const { ctx, call, writes } = fixture();
  await call('capture', teamId, team);
  ctx.net.fetch = async () => ({ status: 200, body: '{"ok":false,"error":"token_revoked"}' });
  await assert.rejects(async () => call('switchTo', team.user_id), /token_revoked/);
  assert.deepEqual(writes, []);
  assert.equal(((await call('list')) as unknown[]).length, 1);
});

test('network and malformed auth responses do not change the active cookie', async () => {
  const { ctx, call, writes } = fixture();
  await call('capture', teamId, team);
  for (const response of [
    { status: 503, body: '' },
    { status: 200, body: 'not json' },
    { status: 200, body: '{}' },
  ]) {
    ctx.net.fetch = async () => response;
    await assert.rejects(async () => call('switchTo', team.user_id), /Could not verify/);
  }
  ctx.net.fetch = async () => {
    throw new Error('offline');
  };
  await assert.rejects(async () => call('switchTo', team.user_id), /Check your connection/);
  assert.deepEqual(writes, []);
});

test('incomplete or non-Slack API hosts cannot initiate a switch', async () => {
  const { call, writes, requests } = fixture();
  for (const url of [undefined, 'https://example.com/', 'http://enterprise.slack.com/']) {
    await assert.rejects(async () => call('capture', teamId, { ...team, url }), /incomplete/);
  }
  assert.deepEqual(requests, []);
  assert.deepEqual(writes, []);
});

test('a redirect cookie paired with stale localConfig cannot overwrite the saved main account', async () => {
  const { ctx, call, writes } = fixture();
  await call('capture', teamId, team);
  ctx.cookies.get = async () => ({ value: 'redirect-session' }) as Electron.Cookie;
  ctx.net.fetch = async (_url, init) => {
    const cookie = new Headers(init?.headers).get('Cookie');
    return {
      status: 200,
      body: JSON.stringify(
        cookie === 'd=saved-session' ? { ok: true, user_id: team.user_id } : { ok: false, error: 'invalid_auth' },
      ),
    };
  };
  await assert.rejects(async () => call('capture', teamId, team), /invalid_auth/);
  await call('switchTo', team.user_id);
  assert.equal(writes[0]!.value, 'saved-session');
});

test('the server identity must match before capturing an account', async () => {
  const { ctx, call } = fixture();
  ctx.net.fetch = async () => ({ status: 200, body: '{"ok":true,"user_id":"U654321"}' });
  await assert.rejects(async () => call('capture', teamId, team), /does not match/);
  assert.deepEqual(await call('list'), []);
});

test('a cookie changed during capture is not saved', async () => {
  const { ctx, call } = fixture();
  ctx.net.fetch = async () => {
    ctx.cookies.get = async () => ({ value: 'changed-session' }) as Electron.Cookie;
    return { status: 200, body: JSON.stringify({ ok: true, user_id: team.user_id }) };
  };
  await assert.rejects(async () => call('capture', teamId, team), /session changed/);
  assert.deepEqual(await call('list'), []);
});

test('a freshly signed-in test account is saved alongside the main account', async () => {
  const { ctx, call } = fixture();
  await call('capture', teamId, team);
  ctx.cookies.get = async () => ({ value: 'test-session' }) as Electron.Cookie;
  ctx.net.fetch = async () => ({ status: 200, body: '{"ok":true,"user_id":"U654321"}' });
  await call('capture', teamId, { ...team, user_id: 'U654321', token: 'test-token' });
  assert.deepEqual(((await call('list')) as { userId: string }[]).map((account) => account.userId).toSorted(), [
    'U123456',
    'U654321',
  ]);
});

test('rejected saved credentials are never probed with another account’s live cookies', async () => {
  const { ctx, call, writes } = fixture();
  await call('capture', teamId, team);
  ctx.cookies.get = async () => {
    throw new Error('must not read the other session');
  };
  const cookies: (string | null)[] = [];
  ctx.net.fetch = async (_url, init) => {
    cookies.push(new Headers(init?.headers).get('Cookie'));
    return { status: 200, body: '{"ok":false,"error":"invalid_auth"}' };
  };
  await assert.rejects(() => call('switchTo', team.user_id), /invalid_auth/);
  assert.deepEqual(cookies, ['d=saved-session']);
  assert.deepEqual(writes, []);
});

test('stale companion cookies retry only the saved pair and restore only the verified cookies', async () => {
  const { ctx, call, writes, requests } = fixture();
  ctx.cookies.get = async ({ name }) =>
    ({
      name,
      value: name === 'd' ? 'saved-session' : `saved-${name}`,
      domain: '.slack.com',
      path: '/',
    }) as Electron.Cookie;
  await call('capture', teamId, team);
  requests.length = 0;
  ctx.net.fetch = async (url, init) => {
    requests.push({ url, init });
    const cookie = new Headers(init?.headers).get('Cookie');
    return {
      status: 200,
      body: JSON.stringify(
        cookie === 'd=saved-session' ? { ok: true, user_id: team.user_id } : { ok: false, error: 'invalid_auth' },
      ),
    };
  };
  await call('switchTo', team.user_id);
  assert.deepEqual(
    requests.map(({ init }) => new Headers(init?.headers).get('Cookie')),
    ['d=saved-session; d-s=saved-d-s; uc=saved-uc', 'd=saved-session'],
  );
  assert.deepEqual(
    writes.map(({ name, value }) => [name, value]),
    [['d', 'saved-session']],
  );
});

test('saved-pair companion retry cannot bypass identity checks or use live cookies', async () => {
  for (const retryResult of [
    { ok: false, error: 'invalid_auth' },
    { ok: true, user_id: 'U654321' },
  ]) {
    const { ctx, call, writes } = fixture();
    ctx.cookies.get = async ({ name }) => ({ name, value: `saved-${name}` }) as Electron.Cookie;
    await call('capture', teamId, team);
    ctx.cookies.get = async () => {
      throw new Error('must not read active cookies');
    };
    const headers: (string | null)[] = [];
    ctx.net.fetch = async (_url, init) => {
      headers.push(new Headers(init?.headers).get('Cookie'));
      assert.equal(init?.body, 'token=saved-token');
      return {
        status: 200,
        body: JSON.stringify(headers.length === 1 ? { ok: false, error: 'invalid_auth' } : retryResult),
      };
    };
    await assert.rejects(() => call('switchTo', team.user_id), /invalid_auth|does not match/);
    assert.deepEqual(headers, ['d=saved-d; d-s=saved-d-s; uc=saved-uc', 'd=saved-d']);
    assert.deepEqual(writes, []);
  }
});

test('wrong identity and revoked credentials cannot initiate a session transition', async () => {
  const { ctx, call, writes } = fixture();
  await call('capture', teamId, team);
  ctx.sessions.navigate = async () => {
    throw new Error('must not navigate');
  };
  for (const result of [
    { ok: true, user_id: 'U654321' },
    { ok: false, error: 'token_revoked' },
  ]) {
    ctx.net.fetch = async () => ({ status: 200, body: JSON.stringify(result) });
    await assert.rejects(() => call('switchTo', team.user_id), /does not match|token_revoked/);
  }
  assert.deepEqual(writes, []);
});

test('OAuth cookie changes emit only a credential-free notification and dispose cleanly', async () => {
  const { ctx } = fixture();
  let listener!: (cookie: Electron.Cookie, removed: boolean) => void;
  let disposed = false;
  const events: unknown[][] = [];
  ctx.cookies.onChanged = (cb) => {
    listener = cb;
    return () => {
      disposed = true;
    };
  };
  ctx.emit = (...args) => {
    events.push(args);
  };
  const dispose = await plugin.ready!(ctx);
  listener({ name: 'd', domain: '.slack.com', value: 'secret' } as Electron.Cookie, false);
  listener({ name: 'd-s', domain: '.slack.com', value: 'secret-signature' } as Electron.Cookie, false);
  listener({ name: 'uc', domain: '.slack.com', value: 'secret-users' } as Electron.Cookie, false);
  listener({ name: 'other', domain: '.slack.com' } as Electron.Cookie, false);
  listener({ name: 'd', domain: 'not-slack.com' } as Electron.Cookie, false);
  assert.deepEqual(events, [['session-changed'], ['session-changed'], ['session-changed']]);
  if (typeof dispose === 'function') await dispose();
  assert.equal(disposed, true);
});

test('manual SSB sign-in captures the old session before requesting isolated sign-in', async () => {
  const { ctx, call, removed } = fixture();
  let signIn!: Parameters<MainCtx['sessions']['onSignIn']>[0];
  ctx.cookies.onChanged = () => () => {};
  ctx.sessions.onSignIn = (handler) => {
    signIn = handler;
    return () => {};
  };
  const steps: string[] = [];
  ctx.sessions.navigate = async (_sender, url, pending, mutate, options) => {
    assert.equal(((await call('list')) as unknown[]).length, 1);
    assert.equal(url, 'https://app.slack.com/ssb/redirect?code=private');
    assert.deepEqual(pending, { action: 'reset' });
    assert.deepEqual(options, { httpReferrer: 'https://auth.hackclub.com/' });
    steps.push('park');
    await mutate();
  };
  await plugin.ready!(ctx);
  const sender = {
    getURL: () => 'https://app.slack.com/client/T123456',
    executeJavaScript: async () => ({ teams: { [teamId]: team } }),
  } as unknown as Electron.WebContents;
  await signIn(sender, 'https://app.slack.com/ssb/redirect?code=private', {
    httpReferrer: 'https://auth.hackclub.com/',
  });
  assert.deepEqual(steps, ['park']);
  assert.deepEqual(removed, ['d', 'd-s', 'uc']);
});

test('SSB companion cookies are preserved, verified and restored without the other login cookies', async () => {
  const { ctx, call, writes, removed } = fixture();
  let active = new Map<string, string>([
    ['d', 'test-d'],
    ['d-s', 'test-signature'],
    ['uc', 'test-users'],
  ]);
  ctx.cookies.get = async ({ name }) =>
    active.has(name!)
      ? ({
          name: name!,
          value: active.get(name!)!,
          domain: '.slack.com',
          path: '/',
          secure: true,
          httpOnly: true,
        } as Electron.Cookie)
      : null;
  ctx.net.fetch = async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('Cookie'), 'd=test-d; d-s=test-signature; uc=test-users');
    return { status: 200, body: JSON.stringify({ ok: true, user_id: team.user_id }) };
  };
  await call('capture', teamId, team);
  active = new Map([
    ['d', 'main-d'],
    ['d-s', 'main-signature'],
    ['uc', 'main-users'],
  ]);
  await call('switchTo', team.user_id);
  assert.deepEqual(removed, ['d', 'd-s', 'uc']);
  assert.deepEqual(
    writes.map(({ name, value }) => [name, value]),
    [
      ['d', 'test-d'],
      ['d-s', 'test-signature'],
      ['uc', 'test-users'],
    ],
  );
});

test('a partial cookie restoration failure rolls back to the active SSB session', async () => {
  const { ctx, call, writes } = fixture();
  await call('capture', teamId, team);
  ctx.cookies.get = async ({ name }) =>
    ({ name: name!, value: `current-${name}`, domain: '.slack.com' }) as Electron.Cookie;
  let failed = false;
  ctx.cookies.set = async (cookie) => {
    if (!failed) {
      failed = true;
      throw new Error('set failed');
    }
    writes.push(cookie);
  };
  await assert.rejects(async () => call('switchTo', team.user_id), /set failed/);
  assert.deepEqual(
    writes.map(({ name, value }) => [name, value]),
    [
      ['d', 'current-d'],
      ['d-s', 'current-d-s'],
      ['uc', 'current-uc'],
    ],
  );
});

test('cookie failures reject switching instead of returning a reload handoff', async () => {
  const { ctx, call } = fixture();
  await call('capture', teamId, team);
  let failed = false;
  ctx.cookies.set = async () => {
    if (!failed) {
      failed = true;
      throw new Error('cookie rejected');
    }
  };
  await assert.rejects(async () => call('switchTo', team.user_id), /cookie rejected/);
});

test('Hack Club browser sign-in opens only after the old client is isolated and cookies cleared', async () => {
  const { ctx, call, removed } = fixture();
  let isolated = false;
  ctx.sessions.navigate = async (_sender, url, pending, mutate) => {
    assert.equal(url, 'https://app.slack.com');
    assert.deepEqual(pending, { action: 'reset' });
    isolated = true;
    await mutate();
  };
  ctx.shell = {
    openExternal: async (url) => {
      assert.equal(isolated, true);
      assert.deepEqual(removed, ['d', 'd-s', 'uc']);
      assert.equal(url, 'https://auth.hackclub.com');
    },
  };
  await call('addAccount', 'hackclub');
});

test('adding an account clears every Slack session cookie without forgetting saved accounts', async () => {
  const { call, removed } = fixture();
  await call('capture', teamId, team);
  await call('addAccount');
  assert.deepEqual(removed, ['d', 'd-s', 'uc']);
  assert.equal(((await call('list')) as unknown[]).length, 1);
});
