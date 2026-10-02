import assert from 'node:assert/strict';
import test from 'node:test';
import { loginWithCookies, parseLoginCookies } from './cookieLogin.ts';

test('accepts raw d, Cookie headers, and browser JSON without leaking unrelated cookies', () => {
  assert.equal(parseLoginCookies('xoxd-fake')[0].value, 'xoxd-fake');
  const header = parseLoginCookies('Cookie: d=xoxd-fake%2F==; d-s=companion; other=private');
  assert.deepEqual(
    header.map((cookie) => cookie.name),
    ['d', 'd-s'],
  );
  assert.equal(header[0].value, 'xoxd-fake%2F==');
  const json = parseLoginCookies(
    JSON.stringify({
      cookies: [
        { name: 'd', value: 'fake', domain: '.slack.com', path: '/', expirationDate: 5000, sameSite: 'None' },
        { name: 'uc', value: 'foreign', domain: 'example.com' },
      ],
    }),
    1000,
  );
  assert.equal(json.length, 1);
  assert.equal(json[0].expirationDate, 5000);
  assert.equal(json[0].sameSite, 'no_restriction');
  assert.equal(json[0].httpOnly, true);
  assert.equal(json[0].secure, true);
});

test('rejects missing, ambiguous, expired, malformed, and oversized sessions', () => {
  for (const input of [
    '',
    '[',
    '{}',
    'd=',
    'd=a; d=b',
    'd=secret\nheader',
    'x'.repeat(256001),
    JSON.stringify([{ name: 'd', value: 'fake', domain: 'evilslack.com' }]),
    JSON.stringify([{ name: 'd', value: 'fake', path: '/other' }]),
    JSON.stringify([{ name: 'd', value: 'fake', expirationDate: 1 }]),
  ])
    assert.throws(
      () => parseLoginCookies(input),
      (error: Error) => !error.message.includes('secret'),
    );
});

function fixture(fail = false) {
  let cookies: any[] = [
    { name: 'd', value: 'old', domain: '.slack.com', path: '/', hostOnly: false, session: false, expirationDate: 9000 },
    { name: 'd-s', value: 'old-companion', domain: 'app.slack.com', path: '/', hostOnly: true, session: true },
    { name: 'other', value: 'keep', domain: '.slack.com', path: '/' },
  ];
  const steps: string[] = [];
  const sender = {
    session: {
      cookies: {
        get: async () => cookies.map((cookie) => ({ ...cookie })),
        remove: async (_url: string, name: string) => {
          steps.push('remove');
          cookies = cookies.filter((cookie) => cookie.name !== name);
        },
        set: async (cookie: any) => {
          steps.push('set');
          if (fail && cookie.value === 'new') throw new Error('secret');
          cookies.push(cookie);
        },
        flushStore: async () => {
          steps.push('flush');
        },
      },
    },
  } as unknown as Electron.WebContents;
  const navigate = async (
    target: Electron.WebContents,
    url: string,
    pending: { action: 'reset' },
    mutate: () => Promise<void>,
  ) => {
    assert.equal(target, sender);
    assert.equal(url, 'https://app.slack.com/client');
    assert.deepEqual(pending, { action: 'reset' });
    steps.push('park');
    await mutate();
    steps.push('load');
  };
  return { sender, navigate, steps, cookies: () => cookies };
}

test('isolates session before changing cookies and flushes before loading Slack', async () => {
  const f = fixture();
  await loginWithCookies(f.sender, 'd=new', f.navigate);
  assert.equal(f.steps[0], 'park');
  assert.deepEqual(f.steps.slice(-2), ['flush', 'load']);
  assert.deepEqual(
    f.cookies().map((cookie) => [cookie.name, cookie.value]),
    [
      ['other', 'keep'],
      ['d', 'new'],
    ],
  );
});

test('invalid input leaves the session untouched; failed writes restore the previous cookies', async () => {
  const f = fixture(true);
  await assert.rejects(loginWithCookies(f.sender, 'invalid', f.navigate));
  assert.equal(f.steps.length, 0);
  await assert.rejects(loginWithCookies(f.sender, 'd=new', f.navigate), /previous cookies were restored/);
  assert.equal(f.steps.includes('load'), false);
  assert.equal(f.cookies().find((cookie) => cookie.name === 'd').value, 'old');
  assert.equal(f.cookies().find((cookie) => cookie.name === 'd').expirationDate, 9000);
  assert.equal(f.cookies().find((cookie) => cookie.name === 'd-s').domain, undefined);
});
