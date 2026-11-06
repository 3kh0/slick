import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrowserCtx } from '../../extension/mainHost.ts';
import browser from './browser.ts';
import { marketplace } from './main.ts';

const PAGE = `<div data-automount-component="AppDirectoryBotUser" data-automount-props="{&quot;memberships&quot;:[&quot;C1&quot;],&quot;otherGroups&quot;:2}"></div>`;
const DATA = { authorizations: [], memberships: ['C1'], otherGroups: 2 };

test('uses the caller’s session cookie jar for a fixed Slack URL', async () => {
  const requests: { url: string; credentials: RequestCredentials | undefined }[] = [];
  const sender = {
    session: {
      fetch: async (url: string, init: RequestInit) => {
        requests.push({ url, credentials: init.credentials });
        return new Response(PAGE);
      },
    },
  } as unknown as Electron.WebContents;
  assert.deepEqual(await marketplace('A123', 'E123', sender), DATA);
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

test('the web half asks its host for the same cookie-bearing request', async () => {
  const requests: { url: string; credentials: RequestCredentials | undefined }[] = [];
  const ctx = {
    net: {
      fetch: async (url: string, init: RequestInit) => {
        requests.push({ url, credentials: init.credentials });
        return { status: requests.length === 1 ? 200 : 403, body: PAGE };
      },
    },
  } as unknown as BrowserCtx;
  const call = async (appId: string) => browser.rpc!.marketplace!(ctx, [appId, 'E123']);
  assert.deepEqual(await call('A123'), DATA);
  await assert.rejects(call('A123'), /unavailable/);
  await assert.rejects(call('../app'), /Invalid app/);
  assert.deepEqual(requests[0], { url: 'https://slack.com/marketplace/A123?team=E123', credentials: 'include' });
  assert.equal(requests.length, 2);
});
