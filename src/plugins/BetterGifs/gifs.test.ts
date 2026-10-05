import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Favorites,
  MAX_FAVORITES,
  fromGiphyProps,
  gifKey,
  normalizeTenorResponse,
  parseFavorites,
  searchKlipy,
  searchTenor,
  topKlipy,
  normalizeKlipyResponse,
  toSlackPayload,
  topTenor,
  filterFavorites,
} from './gifs.ts';
import type { Gif } from './gifs.ts';

const tenorResult = {
  id: '900719925474099312345',
  title: ' Happy cat ',
  description: 'Cat waving',
  gif: 'https://media.tenor.com/cat.gif',
  preview: 'https://media1.tenor.com/cat-preview.gif',
  width: 320,
  height: 240,
  url: 'https://tenor.com/view/cat-900719925474099312345',
};
const tenor: Gif = {
  provider: 'tenor',
  id: tenorResult.id,
  name: 'Happy cat',
  url: tenorResult.gif,
  previewUrl: tenorResult.preview,
  width: 320,
  height: 240,
  pageUrl: tenorResult.url,
};
const giphyProps = {
  id: 'aBc123',
  name: 'Waving dog',
  url: 'https://media.giphy.com/media/aBc123/giphy.gif',
  previewUrl: 'https://i.giphy.com/media/aBc123/200.gif',
  width: 200,
  height: 150,
  bytes: 12345,
  previewBytes: 1234,
};
const giphy: Gif = { provider: 'giphy', ...giphyProps };
const normalize = (overrides: Record<string, unknown> = {}) =>
  normalizeTenorResponse({ results: [{ ...tenorResult, ...overrides }] });
const stored = (gifs: unknown[]) => ({ version: 1, gifs });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function memoryStorage(initial: unknown = stored([])) {
  const writes: { key: string; value: unknown }[] = [];
  let value = initial;
  return {
    writes,
    async get<T>(key: string, fallback: T): Promise<T> {
      assert.equal(key, 'favorites');
      assert.deepEqual(fallback, stored([]));
      return value as T;
    },
    async set(key: string, next: unknown): Promise<boolean> {
      writes.push({ key, value: next });
      value = next;
      return true;
    },
  };
}

test('Tenor normalization preserves exact large string IDs and emits only canonical fields', () => {
  assert.deepEqual(normalize(), [tenor]);
  assert.deepEqual(normalize({ id: '0009007199254740993' })[0].id, '0009007199254740993');
  for (const id of [9007199254740992, 123, null, '', '1e20', '-1', '1.5', '123\n', '1'.repeat(101)]) {
    assert.deepEqual(normalize({ id }), [], String(id));
  }
});

test('Tenor accepts only a results array and skips corrupt entries', () => {
  for (const value of [null, undefined, [], {}, { results: null }, { results: {} }]) {
    assert.deepEqual(normalizeTenorResponse(value), []);
  }
  assert.deepEqual(normalizeTenorResponse({ results: [null, 7, [], {}, tenorResult] }), [tenor]);
});

test('Tenor names are bounded strings, with description and safe default fallbacks', () => {
  assert.equal(normalize({ title: '', description: 'Wave' })[0].name, 'Wave');
  assert.equal(normalize({ title: undefined, description: undefined })[0].name, 'GIF');
  assert.equal(normalize({ title: 'x'.repeat(200) })[0].name.length, 200);
  for (const title of [null, 7, {}, '   ', 'x'.repeat(201), 'cat\nsecret', 'cat\u0085']) {
    assert.deepEqual(normalize({ title }), []);
  }
  assert.deepEqual(normalize({ title: '', description: 42 }), []);
});

test('Tenor requires positive bounded dimensions and can fall back to media dimensions', () => {
  const media = [{ gif: { dims: [640, 480], size: 45678 }, tinygif: { size: 5678 } }];
  assert.deepEqual(normalize({ width: null, height: undefined, media }), [
    { ...tenor, width: 640, height: 480, bytes: 45678, previewBytes: 5678 },
  ]);
  assert.equal(
    normalize({ width: undefined, height: undefined, media: { gif: { width: 100, height: 90 } } })[0].width,
    100,
  );
  for (const dimension of [null, undefined, 'unknown', '320', 0, -1, 1.5, NaN, Infinity, 10_001, {}]) {
    assert.deepEqual(normalize({ width: dimension }), []);
    assert.deepEqual(normalize({ height: dimension }), []);
  }
  assert.equal(normalize({ width: 10_000, height: 1 })[0].width, 10_000);
  assert.deepEqual(normalize({ width: -1, media }), []);
});

test('Tenor can read legacy media URLs without inventing byte sizes', () => {
  assert.deepEqual(
    normalize({
      gif: undefined,
      preview: undefined,
      media: [{ gif: { url: tenor.url }, tinygif: { url: tenor.previewUrl } }],
    }),
    [{ ...tenor, animationUrl: tenor.previewUrl }],
  );
  assert.deepEqual(normalize({ gif: undefined, media: [{ gif: { url: 'https://evil.test/cat.gif' } }] }), []);
});

test('small animated Tenor GIFs are validated and persisted separately from the original and still preview', () => {
  const animationUrl = 'https://media1.tenor.com/cat-tiny.gif';
  const gif = normalize({ media: { tinygif: { url: animationUrl } } })[0];
  assert.deepEqual(gif, { ...tenor, animationUrl });
  assert.deepEqual(parseFavorites(stored([gif])), [gif]);
  assert.deepEqual(toSlackPayload(gif), toSlackPayload(tenor));
  assert.deepEqual(normalize({ media: [{ nanogif: { url: animationUrl } }] }), [{ ...tenor, animationUrl }]);
  for (const url of [
    'https://evil.test/cat.gif',
    'http://media.tenor.com/cat.gif',
    'https://media.giphy.com/cat.gif',
  ]) {
    assert.deepEqual(normalize({ media: { tinygif: { url } } }), []);
    assert.deepEqual(parseFavorites(stored([{ ...tenor, animationUrl: url }])), []);
  }
  assert.deepEqual(parseFavorites(stored([tenor])), [tenor], 'Older favorites need no migration');
});

test('Tenor media host allowlist is exact, including numbered media hosts', () => {
  for (const host of ['media.tenor.com', 'media1.tenor.com', 'media23.tenor.com']) {
    assert.equal(normalize({ gif: `https://${host}/cat.gif` }).length, 1);
  }
  const badUrls = [
    'http://media.tenor.com/cat.gif',
    '//media.tenor.com/cat.gif',
    'javascript:alert(1)',
    'data:image/gif;base64,AA',
    'https://tenor.com/cat.gif',
    'https://media.tenor.com.evil.test/cat.gif',
    'https://evilmedia.tenor.com/cat.gif',
    'https://mediax.tenor.com/cat.gif',
    'https://media.tenor.com@evil.test/cat.gif',
    'https://user:pass@media.tenor.com/cat.gif',
    'https://media.tenor.com:444/cat.gif',
    'https://media.tenor.com./cat.gif',
    'https://media.tenor.com\\@evil.test/cat.gif',
    'https://media.tenor.com/ca\nt.gif',
    ' https://media.tenor.com/cat.gif',
    'https://media.tenor.com/cat.gif#fragment',
    'https://media.tenor.com/%0acat.gif',
    'https://media.giphy.com/cat.gif',
    'https://media.tenor.com/' + 'x'.repeat(4096),
  ];
  for (const url of badUrls) {
    assert.deepEqual(normalize({ gif: url }), [], url);
    assert.deepEqual(normalize({ preview: url }), [], url);
  }
});

test('Tenor page URLs are optional but cannot point to arbitrary or unsafe hosts', () => {
  assert.deepEqual(
    normalize({ url: undefined }),
    [{ ...tenor, pageUrl: undefined }].map(({ pageUrl: _, ...gif }) => gif),
  );
  assert.equal(normalize({ url: 'https://www.tenor.com/view/cat' }).length, 1);
  for (const url of ['https://evil.test/', 'javascript:alert(1)', 'https://tenor.com.evil.test/', null]) {
    assert.deepEqual(normalize({ url }), []);
  }
});

test('Giphy reads named props, preserves byte sizes, and ignores unrelated props', () => {
  assert.deepEqual(fromGiphyProps({ ...giphyProps, onClick: 'ignored', provider: 'tenor' }), giphy);
  assert.equal(fromGiphyProps(Object.values(giphyProps)), null);
  for (const host of ['media.giphy.com', 'media2.giphy.com', 'media99.giphy.com', 'i.giphy.com']) {
    assert.ok(fromGiphyProps({ ...giphyProps, url: `https://${host}/cat.gif` }));
  }
});

test('Giphy rejects corrupt metadata and unsafe original or preview URLs', () => {
  for (const value of [null, {}, [], 'gif']) assert.equal(fromGiphyProps(value), null);
  for (const patch of [
    { id: 123 },
    { id: '' },
    { id: 'a:b' },
    { id: 'abc\n' },
    { id: 'x'.repeat(129) },
    { name: false },
    { name: 'x'.repeat(201) },
    { name: 'cat\u0000' },
    { width: '200' },
    { height: null },
    { width: 0 },
    { height: 10001 },
    { bytes: -1 },
    { bytes: null },
    { bytes: '123' },
    { bytes: Infinity },
    { previewBytes: 1.5 },
    { previewBytes: 1024 * 1024 * 1024 + 1 },
  ])
    assert.equal(fromGiphyProps({ ...giphyProps, ...patch }), null, JSON.stringify(patch));
  for (const url of [
    'http://media.giphy.com/cat.gif',
    'https://giphy.com/cat.gif',
    'https://media.giphy.com.evil.test/cat.gif',
    'https://foo.media.giphy.com/cat.gif',
    'https://ix.giphy.com/cat.gif',
    'https://media.tenor.com/cat.gif',
    'https://user@i.giphy.com/cat.gif',
    'https://i.giphy.com:8080/cat.gif',
    'https://i.giphy.com/ca\rt.gif',
    'data:image/gif;base64,AA',
  ]) {
    assert.equal(fromGiphyProps({ ...giphyProps, url }), null, url);
    assert.equal(fromGiphyProps({ ...giphyProps, previewUrl: url }), null, url);
  }
});

test('Slack payload omits unknown sizes, retains known zero sizes, and excludes provider metadata', () => {
  assert.deepEqual(toSlackPayload(tenor), {
    originalGifUrl: tenor.url,
    previewUrl: tenor.previewUrl,
    name: tenor.name,
    width: 320,
    height: 240,
  });
  assert.equal(Object.hasOwn(toSlackPayload(tenor), 'bytes'), false);
  assert.equal(Object.hasOwn(toSlackPayload(tenor), 'previewBytes'), false);
  assert.deepEqual(toSlackPayload(giphy), {
    originalGifUrl: giphy.url,
    previewUrl: giphy.previewUrl,
    name: giphy.name,
    width: 200,
    height: 150,
    bytes: 12345,
    previewBytes: 1234,
  });
  assert.equal(toSlackPayload({ ...tenor, bytes: 0 }).bytes, 0);
  assert.equal(toSlackPayload({ ...tenor, previewBytes: 0 }).previewBytes, 0);
});

test('favorite keys include the provider and exact ID', () => {
  assert.equal(gifKey(tenor), `tenor:${tenor.id}`);
  assert.notEqual(gifKey(tenor), gifKey({ ...giphy, id: tenor.id }));
});

test('favorites reject corrupt containers and validate every record', () => {
  for (const value of [
    null,
    [],
    'bad JSON',
    {},
    { version: 2, gifs: [tenor] },
    { version: '1', gifs: [] },
    { version: 1, gifs: {} },
  ]) {
    assert.deepEqual(parseFavorites(value), []);
  }
  assert.deepEqual(
    parseFavorites(
      stored([
        null,
        {},
        { ...tenor, provider: 'other' },
        { ...tenor, url: 'https://evil.test/' },
        { ...tenor, width: null },
        { ...giphy, bytes: -1 },
        { ...giphy, pageUrl: 'https://evil.test/' },
        tenor,
        giphy,
      ]),
    ),
    [tenor, giphy],
  );
});

test('favorites dedupe by provider and ID and bound valid entries to 200', () => {
  assert.equal(MAX_FAVORITES, 200);
  assert.deepEqual(parseFavorites(stored([tenor, { ...tenor, name: 'Duplicate' }, { ...giphy, id: tenor.id }])), [
    tenor,
    { ...giphy, id: tenor.id },
  ]);
  const gifs = Array.from({ length: 210 }, (_, index) => ({ ...tenor, id: String(index) }));
  const parsed = parseFavorites(stored([{}, ...gifs.flatMap((gif) => [gif, gif])]));
  assert.equal(parsed.length, 200);
  assert.equal(parsed[199].id, '199');
});

test('Favorites loads once, toggles both providers, and exposes defensive copies', async () => {
  const storage = memoryStorage(stored([tenor]));
  const notifications: Gif[][] = [];
  const favorites = new Favorites(storage, (gifs) => notifications.push(gifs));
  await Promise.all([favorites.load(), favorites.load()]);
  assert.deepEqual(notifications, [[tenor]]);
  const snapshot = favorites.current();
  snapshot[0].name = 'Tampered';
  snapshot.length = 0;
  notifications[0][0].name = 'Tampered callback';
  assert.deepEqual(favorites.current(), [tenor]);
  await favorites.toggle(giphy);
  await favorites.toggle(tenor);
  await favorites.load();
  assert.deepEqual(favorites.current(), [giphy]);
  assert.deepEqual(
    storage.writes.map((write) => write.key),
    ['favorites', 'favorites'],
  );
  assert.deepEqual(storage.writes[1].value, stored([giphy]));
  assert.equal(notifications.length, 3);
});

test('Favorites automatically awaits initial load before a racing toggle', async () => {
  const read = deferred<unknown>();
  const storage = memoryStorage();
  let reads = 0;
  storage.get = async <T>(): Promise<T> => {
    reads++;
    return (await read.promise) as T;
  };
  const notifications: Gif[][] = [];
  const favorites = new Favorites(storage, (gifs) => notifications.push(gifs));
  const load = favorites.load();
  const toggle = favorites.toggle(giphy);
  await Promise.resolve();
  assert.equal(storage.writes.length, 0);
  read.resolve(stored([tenor]));
  await Promise.all([load, toggle]);
  assert.equal(reads, 1);
  assert.deepEqual(favorites.current(), [tenor, giphy]);
  assert.deepEqual(notifications, [[tenor], [tenor, giphy]]);
});

test('Favorites serializes writes, snapshots queued inputs, and notifies only after persistence', async () => {
  const storage = memoryStorage();
  const firstWrite = deferred<boolean>();
  const firstStarted = deferred<void>();
  const notifications: Gif[][] = [];
  let writes = 0;
  storage.set = async (key, value) => {
    storage.writes.push({ key, value });
    if (++writes === 1) {
      firstStarted.resolve();
      return firstWrite.promise;
    }
    return true;
  };
  const favorites = new Favorites(storage, (gifs) => notifications.push(gifs));
  await favorites.load();
  const first = favorites.toggle(tenor);
  const input = { ...giphy };
  const second = favorites.toggle(input);
  input.id = 'mutated';
  await firstStarted.promise;
  assert.equal(writes, 1);
  assert.deepEqual(favorites.current(), []);
  assert.deepEqual(notifications, [[]]);
  firstWrite.resolve(true);
  await Promise.all([first, second]);
  assert.deepEqual(favorites.current(), [tenor, giphy]);
  assert.deepEqual(
    storage.writes.map((write) => write.value),
    [stored([tenor]), stored([tenor, giphy])],
  );
  await Promise.all([favorites.toggle(tenor), favorites.toggle(tenor)]);
  assert.deepEqual(favorites.current(), [giphy, tenor]);
});

test('Favorites false and rejected writes preserve state and do not poison subsequent updates', async () => {
  for (const failure of ['false', 'reject']) {
    const storage = memoryStorage(stored([tenor]));
    let writes = 0;
    storage.set = async () => {
      if (++writes === 1) {
        if (failure === 'reject') throw new Error('Disk unavailable');
        return false;
      }
      return true;
    };
    const notifications: Gif[][] = [];
    const favorites = new Favorites(storage, (gifs) => notifications.push(gifs));
    await favorites.load();
    await assert.rejects(favorites.toggle(tenor), failure === 'false' ? /Could not save/ : /Disk unavailable/);
    assert.deepEqual(favorites.current(), [tenor]);
    assert.deepEqual(notifications, [[tenor]]);
    await favorites.toggle(giphy);
    assert.deepEqual(favorites.current(), [tenor, giphy]);
  }
});

test('Favorites rejects additions at the limit without dropping entries, but permits removal', async () => {
  const gifs = Array.from({ length: MAX_FAVORITES }, (_, index) => ({ ...tenor, id: String(index) }));
  const storage = memoryStorage(stored(gifs));
  const favorites = new Favorites(storage, () => {});
  await assert.rejects(favorites.toggle(giphy), /limit.*200/);
  assert.deepEqual(favorites.current(), gifs);
  assert.equal(storage.writes.length, 0);
  await favorites.toggle(gifs[0]);
  await favorites.toggle(giphy);
  assert.equal(favorites.current().length, MAX_FAVORITES);
  assert.deepEqual(favorites.current().at(-1), giphy);
});

test('Favorites handles corrupt storage, rejects invalid toggles, and retries a failed load', async () => {
  const storage = memoryStorage({ version: 1, gifs: [null, { ...tenor, width: null }] });
  const favorites = new Favorites(storage, () => {});
  await favorites.load();
  assert.deepEqual(favorites.current(), []);
  await assert.rejects(favorites.toggle({ ...tenor, url: 'https://evil.test/' }), /Invalid favorite/);
  assert.equal(storage.writes.length, 0);
  await favorites.toggle(tenor);
  assert.deepEqual(favorites.current(), [tenor]);

  const retryStorage = memoryStorage(stored([giphy]));
  const get = retryStorage.get;
  let reads = 0;
  retryStorage.get = async <T>(key: string, fallback: T): Promise<T> => {
    if (++reads === 1) throw new Error('Read failed');
    return get(key, fallback);
  };
  const retry = new Favorites(retryStorage, () => {});
  await assert.rejects(retry.toggle(tenor), /Read failed/);
  assert.equal(retryStorage.writes.length, 0);
  await retry.toggle(tenor);
  assert.deepEqual(retry.current(), [giphy, tenor]);
});

test('topTenor loads the real top endpoint without a fabricated search query', async () => {
  const gifs = await topTenor(async (url) => {
    assert.equal(url, 'https://tenor-proxy.vercel.app/api/top?limit=50');
    return {
      status: 200,
      body: JSON.stringify({ results: [tenorResult, { ...tenorResult, gif: 'https://evil.test/x.gif' }] }),
    };
  });
  assert.deepEqual(gifs, [tenor]);
  await assert.rejects(
    topTenor(async () => ({ status: 404, body: 'private' })),
    /Top GIF request failed \(HTTP 404\)/,
  );
  await assert.rejects(
    topTenor(async () => ({ status: 200, body: '{}' })),
    /invalid response/,
  );
  await assert.rejects(
    topTenor(async () => ({ status: 200, body: 'invalid json' })),
    /invalid JSON/,
  );
  await assert.rejects(
    topTenor(async () => {
      throw new Error('private upstream details');
    }),
    { message: 'Top GIF network request failed.' },
  );
  await assert.rejects(
    topTenor(async () => ({ status: 200, body: ' '.repeat(2 * 1024 * 1024 + 1) })),
    /too large/,
  );
});

test('favorites filter locally by case-insensitive title words and provider without changing stored GIFs', () => {
  const gifs = [tenor, giphy];
  assert.deepEqual(filterFavorites(gifs, '  CAT  happy tenor '), [tenor]);
  assert.deepEqual(filterFavorites(gifs, 'giphy dog'), [giphy]);
  assert.deepEqual(filterFavorites(gifs, 'TENOR dog'), []);
  assert.deepEqual(filterFavorites(gifs, '  '), gifs);
  assert.deepEqual(gifs, [tenor, giphy]);
});

test('searchTenor encodes normalized spaces and special characters and requests exactly 50 results', async () => {
  let calls = 0;
  const gifs = await searchTenor(async (url, init) => {
    calls++;
    assert.equal(url, 'https://tenor-proxy.vercel.app/api/search?q=cats+%26+dogs%3F&limit=50');
    assert.equal(init, undefined);
    return { status: 200, body: JSON.stringify({ results: [tenorResult] }) };
  }, '  cats   &  dogs?  ');
  assert.equal(calls, 1);
  assert.deepEqual(gifs, [tenor]);
  assert.deepEqual(await searchTenor(async () => ({ status: 200, body: '{"results":[]}' }), 'x'.repeat(100)), []);
});

test('searchTenor rejects invalid queries before calling the fetcher', async () => {
  for (const query of [
    '',
    '   ',
    'x'.repeat(101),
    'cat\nsecret',
    'cat\tsecret',
    'cat\u0000',
    'cat\u007f',
    'cat\u0085',
  ]) {
    await assert.rejects(
      searchTenor(async () => {
        assert.fail('Invalid query must not fetch');
      }, query),
      /query/,
    );
  }
});

test('searchTenor reports HTTP and network failures without leaking response or query', async () => {
  for (const status of [199, 301, 403, 429, 500]) {
    await assert.rejects(
      searchTenor(async () => ({ status, body: 'private response' }), 'private query'),
      {
        message: `GIF search request failed (HTTP ${status}).`,
      },
    );
  }
  await assert.rejects(
    searchTenor(async () => {
      throw new Error('private query and response');
    }, 'private query'),
    {
      message: 'GIF search network request failed.',
    },
  );
  await assert.rejects(
    searchTenor(async () => ({ status: NaN, body: '' }), 'cat'),
    {
      message: 'GIF search request failed.',
    },
  );
});

test('searchTenor rejects malformed JSON and schemas with readable redacted errors', async () => {
  for (const body of ['private response', '', '{']) {
    await assert.rejects(
      searchTenor(async () => ({ status: 200, body }), 'private query'),
      {
        message: 'GIF search returned invalid JSON.',
      },
    );
  }
  for (const body of ['null', '[]', '{}', '{"results":null}', '{"results":{}}']) {
    await assert.rejects(
      searchTenor(async () => ({ status: 200, body }), 'private query'),
      {
        message: 'GIF search returned an invalid response.',
      },
    );
  }
  assert.deepEqual(await searchTenor(async () => ({ status: 200, body: '{"results":[null,{}]}' }), 'cat'), []);
});

test('searchTenor caps UTF-8 body bytes, not just character count', async () => {
  for (const body of [
    ' '.repeat(2 * 1024 * 1024 + 1),
    JSON.stringify({ results: [], padding: '猫'.repeat(750_000) }),
  ]) {
    await assert.rejects(
      searchTenor(async () => ({ status: 200, body }), 'cat'),
      /too large/,
    );
  }
  const body = '{"results":[]}' + ' '.repeat(2 * 1024 * 1024 - '{"results":[]}'.length);
  assert.deepEqual(await searchTenor(async () => ({ status: 200, body }), 'cat'), []);
});

const klipyItem = (slug: string) => ({
  id: 1,
  slug,
  title: ' Dancing cat ',
  type: 'gif',
  file: {
    md: {
      gif: {
        url: `https://static.klipy.com/${slug}/md.gif`,
        width: 300,
        height: 200,
        size: 4000,
      },
    },
    sm: {
      gif: {
        url: `https://static.klipy.com/${slug}/sm.gif`,
        width: 150,
        height: 100,
        size: 900,
      },
    },
  },
});
const klipyBody = (items: unknown[]) => JSON.stringify({ result: true, data: { data: items, has_next: false } });

test('normalizeKlipyResponse maps md/sm gifs and skips ads and bad items', () => {
  const gifs = normalizeKlipyResponse({
    result: true,
    data: {
      data: [klipyItem('dancing-cat'), { type: 'ad', content: '<div/>', width: 1, height: 1 }, { slug: 'x' }],
    },
  });
  assert.deepEqual(gifs, [
    {
      provider: 'klipy',
      id: 'dancing-cat',
      name: 'Dancing cat',
      url: 'https://static.klipy.com/dancing-cat/md.gif',
      previewUrl: 'https://static.klipy.com/dancing-cat/sm.gif',
      animationUrl: 'https://static.klipy.com/dancing-cat/sm.gif',
      width: 300,
      height: 200,
      bytes: 4000,
      previewBytes: 900,
      pageUrl: 'https://klipy.com/gifs/dancing-cat',
    },
  ]);
  assert.deepEqual(normalizeKlipyResponse({ data: {} }), []);
});

test('klipy favorites round-trip and reject foreign hosts', () => {
  const [gif] = normalizeKlipyResponse(JSON.parse(klipyBody([klipyItem('a-b')])));
  assert.deepEqual(parseFavorites({ version: 1, gifs: [gif] }), [gif]);
  assert.deepEqual(
    parseFavorites({
      version: 1,
      gifs: [{ ...gif, url: 'https://evil.example/x.gif' }],
    }),
    [],
  );
  assert.equal(gifKey(gif!), 'klipy:a-b');
});

test('searchKlipy and topKlipy build keyed urls and surface errors without leaking the key', async () => {
  const seen: string[] = [];
  const fetcher = async (url: string) => {
    seen.push(url);
    return { status: 200, body: klipyBody([klipyItem('s')]) };
  };
  assert.equal((await searchKlipy(fetcher, ' secretkey123 ', '  cat   dance ')).length, 1);
  assert.equal((await topKlipy(fetcher, 'secretkey123')).length, 1);
  const search = new URL(seen[0]!);
  assert.equal(search.pathname, '/api/v1/secretkey123/gifs/search');
  assert.equal(search.searchParams.get('q'), 'cat dance');
  assert.equal(search.searchParams.get('per_page'), '50');
  assert.equal(new URL(seen[1]!).pathname, '/api/v1/secretkey123/gifs/trending');
  await assert.rejects(topKlipy(fetcher, ''), /API key/);
  await assert.rejects(searchKlipy(fetcher, 'bad key!', 'x'), /API key/);
  await assert.rejects(
    searchKlipy(async () => ({ status: 200, body: '{"result":false}' }), 'secretkey123', 'x'),
    (error: Error) => /rejected/.test(error.message) && !error.message.includes('secretkey123'),
  );
  await assert.rejects(
    searchKlipy(async () => ({ status: 500, body: '' }), 'secretkey123', 'x'),
    (error: Error) => /HTTP 500/.test(error.message) && !error.message.includes('secretkey123'),
  );
});

test('klipy key failures point at the API key, other HTTP errors stay generic', async () => {
  // Body captured from the live API: a wrong key is HTTP 404 with { result: false, errors }.
  const rejected = '{"result":false,"errors":{"message":["The provided API key is invalid."]}}';
  for (const status of [401, 403, 404]) {
    await assert.rejects(
      searchKlipy(async () => ({ status, body: rejected }), 'secretkey123', 'x'),
      /Check your KLIPY API key/,
    );
  }
  await assert.rejects(
    topKlipy(async () => ({ status: 404, body: rejected }), 'secretkey123'),
    /Check your KLIPY API key/,
  );
  await assert.rejects(
    searchKlipy(async () => ({ status: 429, body: rejected }), 'secretkey123', 'x'),
    (error: Error) => /HTTP 429/.test(error.message) && !/API key/.test(error.message),
  );
});
