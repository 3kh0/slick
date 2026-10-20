import assert from 'node:assert/strict';
import test from 'node:test';
import { marketplace } from './main.ts';

test('uses the caller’s session cookie jar for a fixed Slack URL', async () => {
  const requests: { url: string; credentials: RequestCredentials | undefined }[] = [];
  const sender = {
    session: {
      fetch: async (url: string, init: RequestInit) => {
        requests.push({ url, credentials: init.credentials });
        return new Response('app page');
      },
    },
  } as unknown as Electron.WebContents;
  assert.equal(await marketplace('A123', 'E123', sender), 'app page');
  assert.deepEqual(requests, [{ url: 'https://slack.com/marketplace/A123?team=E123', credentials: 'include' }]);
});

test('rejects non-ID arguments before making a request', async () => {
  const sender = {
    session: {
      fetch: () => {
        throw Error('must not fetch');
      },
    },
  } as unknown as Electron.WebContents;
  await assert.rejects(marketplace('../app', 'E123', sender), /Invalid app/);
  await assert.rejects(marketplace('A123', 'https://example.org', sender), /Invalid workspace/);
});
