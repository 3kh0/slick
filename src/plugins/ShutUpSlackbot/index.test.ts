import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('./index.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { default: ShutUpSlackbot } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);
const notice = {
  user: 'USLACKBOT',
  text: 'A <https://example.test|new> slash command /deploy was added to this workspace',
  channel: 'DTEST',
  ts: '1234.5678',
};
function fixture(loader = 'chromium') {
  const abort = new AbortController();
  let listener!: (event: unknown) => void;
  let wrap!: (original: (...args: any[]) => any) => (...args: any[]) => any;
  const marks: { method: string; args: unknown; signal: AbortSignal }[] = [];
  let reject = false;
  const plugin = new ShutUpSlackbot(
    {
      loader,
      signal: abort.signal,
      redux: {
        patchThunk(name: string, callback: typeof wrap) {
          assert.equal(name, 'showNotification');
          wrap = callback;
        },
      },
      rtm: {
        on(type: string, callback: typeof listener) {
          assert.equal(type, 'message');
          listener = callback;
        },
      },
      userAPI: async (method: string, args: unknown, options: { signal: AbortSignal }) => {
        marks.push({ method, args, signal: options.signal });
        if (reject) throw new Error('offline');
      },
    },
    {},
  );
  plugin.start();
  return {
    plugin,
    abort,
    marks,
    emit: (event: unknown) => listener(event),
    wrap: () => wrap,
    reject: () => (reject = true),
  };
}

test('browser vetoes only Slackbot registration notifications before original sound/display work', async () => {
  for (const loader of ['chromium', 'firefox']) {
    const f = fixture(loader);
    const result = {};
    const calls: unknown[][] = [];
    const wrapped = f.wrap()((...args) => {
      calls.push(args);
      return result;
    });
    const thunk = wrapped({ message: notice });
    assert.equal(typeof thunk, 'function');
    assert.equal(await thunk(), undefined);
    assert.equal(calls.length, 0);
    for (const message of [
      { ...notice, user: 'UHUMAN' },
      { ...notice, user: 'UAPP', username: 'Slackbot Deluxe' },
      { ...notice, text: 'A new member joined #general' },
      { ...notice, text: 'Slash commands are unavailable right now' },
      undefined,
    ]) {
      const args = [{ message }, 'extra'];
      assert.equal(wrapped(...args), result);
      assert.deepEqual(calls.at(-1), args);
    }
    assert.equal(f.marks.length, 0);
  }
});

test('RTM marks matching notices once, ignores unrelated messages and stops after abort', async () => {
  const f = fixture();
  f.emit(notice);
  f.emit(notice);
  f.emit({ ...notice, user: 'UHUMAN', ts: '1234.5679' });
  f.emit({ ...notice, text: 'hello', ts: '1234.5680' });
  f.emit({ ...notice, ts: undefined });
  assert.deepEqual(f.marks, [
    { method: 'conversations.mark', args: { channel: 'DTEST', ts: '1234.5678' }, signal: f.abort.signal },
  ]);
  await Promise.resolve();
  f.abort.abort();
  f.emit({ ...notice, ts: '1234.5681' });
  assert.equal(f.marks.length, 1);
});

test('failed read marks may retry; desktop retains its native notification filter', async () => {
  const f = fixture('electron');
  assert.equal(f.wrap(), undefined);
  f.reject();
  f.emit(notice);
  await Promise.resolve();
  f.emit(notice);
  await Promise.resolve();
  assert.equal(f.marks.length, 2);
});
