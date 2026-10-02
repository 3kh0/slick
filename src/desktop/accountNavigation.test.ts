import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createAccountNavigation, isSsbSignIn } from './accountNavigation.ts';

const team = { token: 'target-token', user_id: 'U123456', url: 'https://enterprise.slack.com/' };
const handoff = { teamId: 'T123456', userId: team.user_id, team };

function fixture() {
  const steps: string[] = [];
  const pages: string[] = [];
  const events: { event: string; details: unknown }[] = [];
  const session = {
    cookies: { get: async (_filter: Electron.CookiesGetFilter): Promise<Electron.Cookie[]> => [] },
    clearStorageData: async (options: { storages: string[] }) => {
      steps.push(`clear:${options.storages.join(',')}`);
    },
  };
  let next = 0;
  const make = (url: string, cookieSession: object = session) => {
    const emitter = new EventEmitter();
    const id = ++next;
    return Object.assign(emitter, {
      id,
      session: cookieSession,
      getURL: () => url,
      isDestroyed: () => false,
      executeJavaScript: async (script: string) => {
        pages.push(script);
      },
      loadURL: async (target: string) => {
        steps.push(`${id}:${target}`);
        url = target;
      },
    }) as unknown as Electron.WebContents;
  };
  const sender = make('https://app.slack.com/client/T123456');
  const clients = [sender];
  let created!: (contents: Electron.WebContents) => void;
  let allowed: ((contents: Electron.WebContents) => boolean) | undefined;
  const navigation = createAccountNavigation(
    () => clients,
    (listener) => {
      created = listener;
      return () => {};
    },
    (_session, gate) => {
      allowed = gate;
      return () => {
        allowed = undefined;
      };
    },
    (event, details) => events.push({ event, details }),
  );
  return {
    steps,
    pages,
    events,
    session,
    sender,
    clients,
    navigation,
    make,
    requestAllowed: (contents: Electron.WebContents) => (allowed ? allowed(contents) : true),
    created: (contents: Electron.WebContents) => created(contents),
  };
}

test('SSB detection allowlists HTTPS Slack redirect endpoints without trusting lookalike domains', () => {
  assert.equal(isSsbSignIn('https://app.slack.com/ssb/redirect?code=never-log-me'), true);
  assert.equal(isSsbSignIn('https://slack.com/ssb/redirect'), true);
  assert.equal(isSsbSignIn('https://app.slack.com/api/auth.loginMagicBulk?magic_tokens=private&ssb=1'), true);
  assert.equal(isSsbSignIn('https://slack.com/api/auth.loginMagic'), true);
  for (const url of [
    'http://app.slack.com/ssb/redirect',
    'https://not-slack.com/ssb/redirect',
    'https://slack.com.evil.test/ssb/redirect',
    'https://user@slack.com/ssb/redirect',
    'https://slack.com/ssb/download-osx-universal',
    'https://not-slack.com/api/auth.loginMagicBulk',
    'https://app.slack.com/api/auth.loginMagicBulk/other',
    'https://user@slack.com/api/auth.loginMagicBulk',
    'https://app.slack.com/api/auth.test',
    'slack://signin',
    'invalid',
  ]) {
    assert.equal(isSsbSignIn(url), false);
  }
});

test('all old clients unload before any credential mutation and handoff is delivered once', async () => {
  const { steps, sender, clients, navigation, make } = fixture();
  clients.push(make('https://app.slack.com/client/T654321'));
  clients.push(make('https://example.com/'));
  clients.push(make('https://app.slack.com/client/T999999', { clearStorageData: async () => {} }));
  await navigation.navigate(sender, 'https://app.slack.com/client/T123456', handoff, async () => {
    steps.push('cookies');
  });
  assert.deepEqual(steps, [
    '1:about:blank',
    '2:about:blank',
    'clear:localstorage,indexdb,serviceworkers,cachestorage',
    'cookies',
    '1:https://app.slack.com/client/T123456',
  ]);
  assert.deepEqual(navigation.takeHandoff(sender), handoff);
  assert.equal(navigation.takeHandoff(sender), null);
});

test('failed parking leaves cookies untouched and never starts the sign-in request', async () => {
  const { steps, sender, navigation } = fixture();
  sender.loadURL = async () => {
    throw new Error('unload prevented');
  };
  await assert.rejects(
    navigation.navigate(sender, 'https://slack.com/ssb/redirect', { action: 'reset' }, async () => {
      steps.push('cookies');
    }),
    /unload prevented/,
  );
  assert.deepEqual(steps, []);
  assert.equal(navigation.takeHandoff(sender), null);
});

test('SSB loadURL requests, renderer navigation and popup routing all use the isolated transition', async () => {
  const { steps, sender, navigation, make, created } = fixture();
  const routed: string[] = [];
  const url = 'https://app.slack.com/ssb/redirect?code=private';
  const dispose = navigation.onSignIn(async (contents, target) => {
    routed.push(target);
    await navigation.navigate(contents, target, { action: 'reset' }, async () => {
      steps.push('cookies');
    });
  });
  await sender.loadURL(url);
  assert.deepEqual(steps, [
    '1:about:blank',
    'clear:localstorage,indexdb,serviceworkers,cachestorage',
    'cookies',
    `1:${url}`,
  ]);
  assert.equal(navigation.takeHandoff(sender), null);
  const newClient = make('https://app.slack.com/client/T123456');
  created(newClient);
  let prevented = false;
  newClient.emit(
    'will-navigate',
    {
      preventDefault: () => {
        prevented = true;
      },
    },
    url,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.equal(routed.length, 2);
  assert.equal(navigation.interceptSignIn(sender, url), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(routed.length, 3);
  dispose();
  assert.equal(navigation.interceptSignIn(sender, url), false);
  assert.equal(sender.listenerCount('will-navigate'), 0);
});

test('native hidden-window magic login parks old clients before loading and preserves its one-shot load observer', async () => {
  const { steps, clients, navigation, make } = fixture();
  clients.push(make('https://app.slack.com/client/T654321'));
  const hidden = make('');
  clients.push(hidden);
  const target = 'https://app.slack.com/api/auth.loginMagicBulk?magic_tokens=private&ssb=1';
  let completed: string | undefined;
  const load = hidden.loadURL;
  hidden.loadURL = async (url, options) => {
    await load(url, options);
    hidden.emit('did-finish-load');
  };
  hidden.once('did-finish-load', () => {
    completed = hidden.getURL();
  });
  navigation.onSignIn(async (sender, url, options) => {
    await navigation.navigate(
      sender,
      url,
      { action: 'reset' },
      async () => {
        assert.equal(clients[0]!.getURL(), 'about:blank');
        assert.equal(clients[1]!.getURL(), 'about:blank');
        steps.push('cookies');
      },
      options,
    );
  });
  await hidden.loadURL(target, { extraHeaders: 'X-Test: preserved' });
  assert.equal(completed, target);
  assert.deepEqual(steps, [
    '1:about:blank',
    '2:about:blank',
    'clear:localstorage,indexdb,serviceworkers,cachestorage',
    'cookies',
    `3:${target}`,
  ]);
});

test('native SSB completion automatically reopens the parked client with fresh storage, not the hidden window', async () => {
  const { sender, clients, navigation, make, session, steps, pages, events } = fixture();
  const hidden = make('');
  clients.push(hidden);
  await navigation.navigate(
    hidden,
    'https://app.slack.com/api/auth.loginMagicBulk?magic_tokens=secret',
    { action: 'reset' },
    async () => {
      session.cookies.get = async () => [{ name: 'd', value: 'new-secret' } as Electron.Cookie];
    },
  );
  assert.equal(sender.getURL(), 'https://app.slack.com/client');
  assert.match(hidden.getURL(), /auth.loginMagicBulk/);
  assert.equal(steps.at(-1), '1:https://app.slack.com/client');
  assert.ok(pages.some((page) => page.includes('Finishing your Slack sign-in')));
  assert.ok(events.some(({ event }) => event === 'signin.complete'));
  assert.doesNotMatch(JSON.stringify(events), /new-secret|magic_tokens|saved-token/);
  assert.equal(navigation.takeHandoff(sender), null);
});

test('failed SSB leaves an actionable page and never boots the previous account', async () => {
  const { sender, clients, navigation, make, pages, events } = fixture();
  const hidden = make('');
  clients.push(hidden);
  await navigation.navigate(
    hidden,
    'https://app.slack.com/api/auth.loginMagicBulk?magic_tokens=secret',
    { action: 'reset' },
    async () => {},
  );
  assert.equal(sender.getURL(), 'about:blank');
  assert.ok(pages.some((page) => page.includes('Sign-in needs attention') && page.includes('Continue to Slack')));
  assert.ok(events.some(({ event }) => event === 'signin.waiting'));
});

test('a superseded SSB completion cannot navigate over a newer account switch', async () => {
  const { sender, clients, navigation, make, session } = fixture();
  const hidden = make('');
  clients.push(hidden);
  let release!: (cookies: Electron.Cookie[]) => void;
  session.cookies.get = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const signin = navigation.navigate(
    hidden,
    'https://app.slack.com/api/auth.loginMagicBulk',
    { action: 'reset' },
    async () => {},
  );
  await new Promise((resolve) => setImmediate(resolve));
  await navigation.navigate(sender, 'https://app.slack.com/client/T123456', handoff, async () => {});
  release([{ name: 'd', value: 'late-cookie' } as Electron.Cookie]);
  await signin;
  assert.equal(sender.getURL(), 'https://app.slack.com/client/T123456');
});

test('SSB does not overwrite a client that Slack already resumed during cookie lookup', async () => {
  const { sender, clients, navigation, make, session, steps } = fixture();
  const hidden = make('');
  clients.push(hidden);
  session.cookies.get = async () => {
    await sender.loadURL('https://app.slack.com/client/NEW');
    return [{ name: 'd', value: 'new-cookie' } as Electron.Cookie];
  };
  await navigation.navigate(
    hidden,
    'https://app.slack.com/api/auth.loginMagicBulk',
    { action: 'reset' },
    async () => {},
  );
  assert.equal(sender.getURL(), 'https://app.slack.com/client/NEW');
  assert.ok(!steps.includes('1:https://app.slack.com/client'));
});

test('SSB retry includes the client parked by a previous failed sign-in', async () => {
  const { sender, clients, navigation, make, session } = fixture();
  const hidden = make('');
  clients.push(hidden);
  await navigation.navigate(
    hidden,
    'https://app.slack.com/api/auth.loginMagicBulk',
    { action: 'reset' },
    async () => {},
  );
  assert.equal(sender.getURL(), 'about:blank');
  const retry = make('');
  clients.push(retry);
  await navigation.navigate(retry, 'https://app.slack.com/api/auth.loginMagicBulk', { action: 'reset' }, async () => {
    session.cookies.get = async () => [{ name: 'd', value: 'new-cookie' } as Electron.Cookie];
  });
  assert.equal(sender.getURL(), 'https://app.slack.com/client');
});

test('concurrent transitions fail closed instead of changing cookies twice', async () => {
  const { sender, navigation } = fixture();
  let release!: () => void;
  const first = navigation.navigate(
    sender,
    'https://app.slack.com/client/T123456',
    handoff,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  let changed = false;
  await assert.rejects(
    navigation.navigate(sender, 'https://slack.com/ssb/redirect', { action: 'reset' }, async () => {
      changed = true;
    }),
    /already in progress/,
  );
  assert.equal(changed, false);
  release();
  await first;
});

test('new windows cannot navigate or send Slack requests during a credential transition', async () => {
  const { sender, navigation, make, created, requestAllowed } = fixture();
  navigation.onSignIn(async () => {});
  let release!: () => void;
  const swapping = navigation.navigate(
    sender,
    'https://app.slack.com/client/T123456',
    handoff,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const newClient = make('about:blank');
  created(newClient);
  assert.equal(requestAllowed(sender), false);
  assert.equal(requestAllowed(newClient), false);
  await assert.rejects(newClient.loadURL('https://app.slack.com/client/T123456'), /transition/);
  release();
  await swapping;
  assert.equal(requestAllowed(newClient), true);
});

test('mutation failure never reloads the old token and leaves a readable recovery page', async () => {
  const { steps, sender, navigation } = fixture();
  await assert.rejects(
    navigation.navigate(sender, 'https://app.slack.com/client/T123456', handoff, async () => {
      throw new Error('cookies failed');
    }),
    /cookies failed/,
  );
  assert.equal(
    steps.some((step) => step.includes('https://app.slack.com/client')),
    false,
  );
  assert.match(steps.at(-1)!, /data:text\/html/);
  assert.equal(navigation.takeHandoff(sender), null);
});
