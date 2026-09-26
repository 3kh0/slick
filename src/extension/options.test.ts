import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CssDraft, recover, recoveryScript, slackClient, updateSetting } from './options.ts';
import type { Request } from './rpc.ts';

test('CAS retries with latest settings, preserving unrelated nested properties', async () => {
  let stored = JSON.stringify({ enabled: false, plugins: { HumanCount: { enabled: false, extra: 1 } } });
  let attempts = 0;
  const send = async ({ method, args }: Request) => {
    if (method === 'readSettings') return { ok: true, value: stored };
    assert.equal(method, 'compareAndSwapSettings');
    assert.equal(args[0], stored);
    if (++attempts === 1) {
      stored = JSON.stringify({ ...JSON.parse(stored), theme: 'amoled', unknown: 42 });
      return { ok: true, value: false };
    }
    stored = args[1];
    return { ok: true, value: true };
  };
  await updateSetting(send, { property: 'plugin', id: 'HumanCount', value: true });
  assert.deepEqual(JSON.parse(stored), {
    enabled: false,
    plugins: { HumanCount: { enabled: true, extra: 1 } },
    theme: 'amoled',
    unknown: 42,
  });
  assert.equal(attempts, 2);
});

test('CAS is bounded and rejects malformed settings or failed responses', async () => {
  let attempts = 0;
  await assert.rejects(
    updateSetting(
      async ({ method }) => {
        if (method === 'readSettings') return { ok: true, value: '{}' };
        attempts++;
        return { ok: true, value: false };
      },
      { property: 'enabled', value: true },
    ),
  );
  assert.equal(attempts, 8);
  for (const value of ['[]', '{', 'null']) {
    await assert.rejects(updateSetting(async () => ({ ok: true, value }), { property: 'theme', value: 'custom' }));
  }
  await assert.rejects(
    updateSetting(async () => ({ ok: false, error: 'Failed' }), { property: 'enabled', value: true }),
  );
});

test('CSS remote changes never clobber drafts; failures keep dirty state', async () => {
  const draft = new CssDraft();
  draft.remote('initial');
  draft.edit('draft');
  draft.remote('remote');
  assert.equal(draft.value, 'draft');
  for (const response of [
    { ok: false, error: 'Failed' },
    { ok: true, value: false },
  ]) {
    await assert.rejects(draft.save(async () => response));
    assert.equal(draft.value, 'draft');
    assert.equal(draft.dirty, true);
    assert.equal(draft.saving, false);
  }
  let acknowledge!: (value: unknown) => void;
  const pending = draft.save(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  );
  draft.edit('newer draft');
  draft.remote('remote during save');
  acknowledge({ ok: true, value: true });
  await pending;
  assert.equal(draft.value, 'newer draft');
  assert.equal(draft.dirty, true);
  await draft.save(async () => ({ ok: true, value: true }));
  assert.equal(draft.dirty, false);
  draft.remote('new remote');
  assert.equal(draft.value, 'new remote');
});

test('recovery targets only the active Slack client, in MAIN world', async () => {
  let url = 'https://example.com/client';
  let executions = 0;
  const api = {
    tabs: {
      query: async (options: unknown) => {
        assert.deepEqual(options, { active: true, currentWindow: true });
        return [{ id: 3, url }];
      },
    },
    scripting: {
      executeScript: async (options: unknown) => {
        executions++;
        assert.deepEqual(options, { target: { tabId: 3 }, world: 'MAIN', func: recoveryScript, args: ['bypass'] });
        return [{ result: true }];
      },
    },
  } as unknown as Parameters<typeof recover>[0];
  await assert.rejects(recover(api, 'bypass'));
  assert.equal(executions, 0);
  url = 'https://app.slack.com/client/T123';
  await recover(api, 'bypass');
  assert.equal(executions, 1);
  for (const invalid of [
    undefined,
    'https://app.slack.com.evil/client',
    'http://app.slack.com/client',
    'https://app.slack.com/clientish',
  ])
    assert.equal(slackClient(invalid), false);
});

test('packaged recovery function sets and clears only recovery flags', () => {
  const data = new Map<string, string>([['unrelated', 'keep']]);
  let reloads = 0;
  const oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin: 'https://app.slack.com', pathname: '/client/T', reload: () => reloads++ },
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: { setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) },
  });
  try {
    recoveryScript('bypass');
    assert.equal(data.get('slick:firefox:bypass'), '1');
    recoveryScript('safe-mode');
    assert.equal(data.has('slick:firefox:bypass'), false);
    assert.equal(data.get('slick:firefox:safe-mode'), '1');
    recoveryScript('resume');
    assert.deepEqual([...data], [['unrelated', 'keep']]);
    assert.equal(reloads, 3);
    location.pathname = '/other';
    assert.equal(recoveryScript('bypass'), false);
    assert.equal(reloads, 3);
  } finally {
    if (oldLocation) Object.defineProperty(globalThis, 'location', oldLocation);
    else Reflect.deleteProperty(globalThis, 'location');
    if (oldStorage) Object.defineProperty(globalThis, 'sessionStorage', oldStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});
