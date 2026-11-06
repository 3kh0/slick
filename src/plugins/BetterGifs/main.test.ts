import assert from 'node:assert/strict';
import test from 'node:test';
import type { MainCtx } from '../../shared/main.ts';
import { MAX_TEXT } from '../../extension/rpc.ts';
import plugin, { MAX_RESULT_BYTES } from './main.ts';

const KEY = 'test_key_12345678';
const tenor = {
  id: '123',
  title: 'Cat',
  gif: 'https://media.tenor.com/cat.gif',
  preview: 'https://media.tenor.com/preview.gif',
  width: 320,
  height: 240,
};

function fixture() {
  const requests: { url: string; init?: RequestInit }[] = [];
  const settings = { klipyApiKey: KEY };
  let fetcher = async (_url: string, _init?: RequestInit) => ({ status: 200, body: '{"results":[]}' });
  const ctx = {
    settings,
    net: {
      fetch(url: string, init?: RequestInit) {
        requests.push({ url, init });
        return fetcher(url, init);
      },
    },
    log() {
      assert.fail('Provider data must not be logged');
    },
  } as unknown as MainCtx;
  return {
    requests,
    settings,
    call: (...args: unknown[]) => plugin.rpc.search(ctx, args),
    fetchWith(implementation: typeof fetcher) {
      fetcher = implementation;
    },
  };
}

test('search and top use fixed provider URLs, anonymous requests and the current settings key', async () => {
  const f = fixture();
  await f.call('tenor', '  happy   cats & dogs ');
  await f.call('tenor', '');
  f.fetchWith(async () => ({ status: 200, body: '{"result":true,"data":{"data":[]}}' }));
  await f.call('klipy', 'cats & dogs');
  f.settings.klipyApiKey = '  changed_key_123  ';
  await f.call('klipy', '');
  assert.deepEqual(
    f.requests.map(({ url }) => url),
    [
      'https://tenor-proxy.vercel.app/api/search?q=happy+cats+%26+dogs&limit=50',
      'https://tenor-proxy.vercel.app/api/top?limit=50',
      `https://api.klipy.com/api/v1/${KEY}/gifs/search?q=cats+%26+dogs&per_page=50&customer_id=slick`,
      'https://api.klipy.com/api/v1/changed_key_123/gifs/trending?per_page=50&customer_id=slick',
    ],
  );
  for (const { init } of f.requests) {
    assert.equal(init?.credentials, 'omit');
    assert.ok(init?.signal instanceof AbortSignal);
  }
});

test('invalid arguments and absent or malformed keys are rejected before networking', async () => {
  const f = fixture();
  for (const provider of ['giphy', 'https://evil.test', null, {}, 7])
    await assert.rejects(f.call(provider, 'cat'), /Invalid GIF provider/);
  await assert.rejects(f.call('tenor', 'cat', KEY), /Invalid GIF provider/);
  for (const provider of ['tenor', 'klipy']) {
    for (const query of [undefined, null, {}, 7, ' ', 'a'.repeat(101), '\n', 'cat\u0000'])
      await assert.rejects(f.call(provider, query), /GIF search query/);
  }
  for (const key of ['', '../secret', 'short']) {
    f.settings.klipyApiKey = key;
    for (const query of ['', 'cat']) await assert.rejects(f.call('klipy', query), /Add your KLIPY API key/);
  }
  assert.equal(f.requests.length, 0);
});

test('provider HTTP, network and body errors keep URLs and API keys out of messages', async () => {
  const f = fixture();
  for (const provider of ['tenor', 'klipy']) {
    for (const query of ['', 'cat']) {
      const label = query ? 'GIF search' : 'Top GIF';
      for (const [status, body, expected] of [
        [403, `https://api.klipy.com/${KEY}`, `${label} request failed (HTTP 403).`],
        [200, `https://api.klipy.com/${KEY}`, `${label} returned invalid JSON.`],
        [200, JSON.stringify({ key: KEY }), `${label} returned an invalid response.`],
      ] as const) {
        f.fetchWith(async () => ({ status, body }));
        await assert.rejects(f.call(provider, query), { message: expected });
      }
      f.fetchWith(async (url) => {
        throw new Error(`Failed fetching ${url} with ${KEY}`);
      });
      await assert.rejects(f.call(provider, query), { message: `${label} network request failed.` });
    }
  }
  f.fetchWith(async () => ({ status: 200, body: JSON.stringify({ result: false, error: KEY }) }));
  await assert.rejects(f.call('klipy', 'cat'), { message: 'GIF search was rejected. Check your KLIPY API key.' });
});

test('provider timeout is below the extension bridge deadline and still produces a sanitized error', async (t) => {
  const signal = AbortSignal.abort(new Error(`https://api.klipy.com/${KEY}`));
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    assert.equal(ms, 8_000);
    return signal;
  });
  const f = fixture();
  f.fetchWith(async (_url, init) => {
    init?.signal?.throwIfAborted();
    assert.fail('Expected an abort signal');
  });
  await assert.rejects(f.call('klipy', 'cat'), { message: 'GIF search network request failed.' });
});

test('normalized results stay below the bridge budget even with maximal URLs and multibyte names', async () => {
  const f = fixture();
  const longUrl = (host: string) => `https://${host}/`.padEnd(4096, 'x');
  const results = Array.from({ length: 50 }, (_, index) => ({
    ...tenor,
    id: String(index),
    title: '猫'.repeat(200),
    gif: longUrl('media.tenor.com'),
    preview: longUrl('media1.tenor.com'),
    url: longUrl('tenor.com'),
    media: [{ tinygif: { url: longUrl('media2.tenor.com') } }],
  }));
  f.fetchWith(async () => ({ status: 200, body: JSON.stringify({ results }) }));
  const gifs = await f.call('tenor', 'cat');
  const bytes = Buffer.byteLength(JSON.stringify(gifs));
  assert.ok(gifs.length > 0 && gifs.length < 50);
  assert.ok(bytes <= MAX_RESULT_BYTES);
  assert.ok(MAX_RESULT_BYTES < MAX_TEXT);
  assert.ok(bytes + Buffer.byteLength(JSON.stringify(gifs[0])) > MAX_RESULT_BYTES);
  f.fetchWith(async () => ({
    status: 200,
    body: JSON.stringify({ results: Array.from({ length: 100 }, () => ({ ...tenor })) }),
  }));
  assert.equal((await f.call('tenor', '')).length, 50);
});
