import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ImageArchive, downloadImage, imageSources } from './images.ts';

const data = 'data:image/png;base64,aGVsbG8=';
const message = {
  files: [
    {
      mimetype: 'image/png',
      title: 'Cat',
      thumb_480: 'https://files.slack.com/cat.png',
      url_private: 'https://files.slack.com/original.png',
    },
  ],
};
async function drain() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
function fixture(download: (url: string, signal: AbortSignal) => Promise<string | null> = async () => data) {
  const values = new Map<string, unknown>();
  const controller = new AbortController();
  let refreshes = 0;
  const store = {
    async entries<T>(prefix: string) {
      return new Map([...values].filter(([key]) => key.startsWith(prefix))) as Map<string, T>;
    },
    async set(key: string, value: unknown) {
      values.set(key, value);
      return true;
    },
    async delete(key: string) {
      return values.delete(key);
    },
  };
  const archive = new ImageArchive(store, controller.signal, () => refreshes++, download);
  return { archive, values, store, controller, refreshes: () => refreshes };
}

test('sources include uploaded images, attachments and image blocks; skip non-images and unsafe URLs', () => {
  assert.deepEqual(
    imageSources({
      files: [...message.files, { mimetype: 'application/pdf', url_private: 'https://files.slack.com/doc.pdf' }],
      attachments: [{ image_url: 'https://example.com/image.png' }, { image_url: 'javascript:alert(1)' }],
      blocks: [{ type: 'image', alt_text: 'Block', image_url: 'https://example.com/block.png' }],
    }),
    [
      { name: 'Cat', urls: ['https://files.slack.com/cat.png', 'https://files.slack.com/original.png'] },
      { name: 'Deleted image', urls: ['https://example.com/image.png'] },
      { name: 'Block', urls: ['https://example.com/block.png'] },
    ],
  );
});

test('previews are downloaded once before deletion and persisted separately only when retained', async () => {
  const requests: string[] = [];
  const f = fixture(async (url) => {
    requests.push(url);
    return data;
  });
  f.archive.capture('C:1', message);
  f.archive.capture('C:1', message);
  await drain();
  assert.deepEqual(requests, ['https://files.slack.com/cat.png']);
  assert.equal(f.values.size, 0);
  f.archive.retain('C:1');
  await drain();
  assert.deepEqual(f.values.get('images:C:1'), [{ name: 'Cat', data }]);
  const restarted = new ImageArchive(f.store, f.controller.signal, () => {});
  await restarted.restore(() => ['C:1']);
  assert.deepEqual(restarted.get('C:1'), [{ name: 'Cat', data }]);
});

test('a delete during download saves the late result; accepting deletion during download discards it', async () => {
  let resolve!: (data: string) => void;
  const f = fixture(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  f.archive.capture('C:1', message);
  f.archive.retain('C:1');
  resolve(data);
  await drain();
  assert.equal(f.archive.get('C:1').length, 1);
  f.archive.capture('C:2', message);
  f.archive.retain('C:2');
  f.archive.forget('C:2');
  resolve(data);
  await drain();
  assert.equal(f.archive.get('C:2').length, 0);
  assert.equal(f.values.has('images:C:2'), false);
  f.archive.forget('C:1');
  await drain();
  assert.equal(f.values.has('images:C:1'), false);
});

test('unavailable previews fall back to original URLs and failures leave logging functional', async () => {
  const f = fixture(async (url) => {
    if (url.includes('cat.png')) throw new Error('Unavailable');
    return data;
  });
  f.archive.capture('C:1', message);
  f.archive.retain('C:1');
  await drain();
  assert.equal(f.archive.get('C:1').length, 1);
  const failed = fixture(async () => null);
  failed.archive.capture('C:1', message);
  failed.archive.retain('C:1');
  await drain();
  assert.equal(failed.values.size, 0);
});

test('edits that remove images clear the pre-deletion cache', async () => {
  const f = fixture();
  f.archive.capture('C:1', message);
  await drain();
  f.archive.capture('C:1', { text: 'image removed' });
  f.archive.retain('C:1');
  await drain();
  assert.equal(f.values.size, 0);
});

test('restore removes orphaned or invalid image data and respects archive bounds', async () => {
  const f = fixture();
  for (let i = 0; i < 130; i++) f.values.set(`images:C:${i}`, [{ name: 'Cat', data }]);
  f.values.set('images:orphan', [{ name: 'Cat', data }]);
  f.values.set('images:invalid', [{ name: 'Bad', data: 'data:image/svg+xml;base64,aGVsbG8=' }]);
  await f.archive.restore(() => [...Array.from({ length: 130 }, (_, i) => `C:${i}`), 'invalid']);
  await drain();
  assert.equal(f.values.size, 128);
  assert.equal(f.archive.get('C:0').length, 0);
  assert.equal(f.archive.get('C:129').length, 1);
});

test('stop ignores downloads that finish after the plugin aborts', async () => {
  let resolve!: (data: string) => void;
  const f = fixture(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  f.archive.capture('C:1', message);
  f.archive.retain('C:1');
  f.controller.abort();
  resolve(data);
  await drain();
  assert.equal(f.values.size, 0);
  assert.equal(f.refreshes(), 0);
});

test('downloads send session cookies and reject non-images and oversized responses', async (t) => {
  const requests: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    requests.push(init);
    return new Response('login page', { headers: { 'content-type': 'text/html' } });
  });
  assert.equal(await downloadImage('https://files.slack.com/image.png', new AbortController().signal), null);
  assert.equal(requests[0].credentials, 'include');
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('huge', { headers: { 'content-type': 'image/png', 'content-length': String(3 * 1024 * 1024) } }),
  );
  assert.equal(await downloadImage('https://files.slack.com/image.png', new AbortController().signal), null);
});

test('small authenticated image responses are saved as image bytes rather than remote URLs', async (t) => {
  class Reader extends EventTarget {
    result = '';
    async readAsDataURL(blob: Blob) {
      this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
      this.dispatchEvent(new Event('load'));
    }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: Reader });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'FileReader', previous);
    else Reflect.deleteProperty(globalThis, 'FileReader');
  });
  t.mock.method(globalThis, 'fetch', async () => new Response('hello', { headers: { 'content-type': 'image/png' } }));
  assert.equal(await downloadImage('https://files.slack.com/image.png', new AbortController().signal), data);
});
