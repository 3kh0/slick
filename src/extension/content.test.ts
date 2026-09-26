import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installRelay } from './content.ts';
import { CHANNEL } from './rpc.ts';
import type { ExtensionBrowser } from './rpc.ts';

test('isolated relay rejects foreign source/origin, malformed messages and runtime failures', async () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const posts: unknown[] = [];
  const calls: unknown[] = [];
  const target = {
    location: { origin: 'https://app.slack.com', pathname: '/client/T' },
    sessionStorage: { getItem: () => null },
    addEventListener: (name: string, cb: (event: unknown) => void) => listeners.set(name, cb),
    postMessage: (m: unknown) => posts.push(m),
  } as unknown as Window;
  Object.defineProperty(target, 'top', { value: target });
  let fail = false;
  const api = {
    runtime: {
      sendMessage: async (m: unknown) => {
        calls.push(m);
        if (fail) throw new Error('private detail');
        return { ok: true, value: '{}' };
      },
    },
    storage: { onChanged: { addListener: () => {} } },
  } as unknown as ExtensionBrowser;
  installRelay(api, target);
  // Reported first, so background request rules can skip safe-mode and bypassed tabs.
  assert.deepEqual(calls.splice(0), [{ method: 'tabMode', args: ['normal'] }]);
  const data = { channel: CHANNEL, kind: 'request', id: 'test-1', method: 'readSettings', args: [] };
  const event = { source: target, origin: target.location.origin, data };
  const receive = listeners.get('message')!;
  receive({ ...event, source: {} });
  receive({ ...event, origin: 'https://evil' });
  receive({ ...event, data: { ...data, method: 'fetch' } });
  receive({ ...event, data: { ...data, kind: 'response' } });
  assert.equal(calls.length, 0);
  receive(event);
  receive(event);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.deepEqual(posts[0], { channel: CHANNEL, kind: 'response', id: 'test-1', response: { ok: true, value: '{}' } });
  fail = true;
  receive({ ...event, data: { ...data, id: 'test-2' } });
  await Promise.resolve();
  assert.deepEqual(posts[1], {
    channel: CHANNEL,
    kind: 'response',
    id: 'test-2',
    response: { ok: false, error: 'Extension disconnected' },
  });
  listeners.get('pagehide')!({});
  receive(event);
  assert.equal(calls.length, 2);
});
