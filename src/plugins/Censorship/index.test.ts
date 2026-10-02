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
const { default: Censorship } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

test('notification censorship masks display text without changing routing or original messages', () => {
  let wrap!: (original: (...args: any[]) => unknown) => (...args: any[]) => unknown;
  const config = { terms: 'job', style: 'stars', replacement: '', keepFirstLetter: false, keepLastLetter: false };
  const plugin = new Censorship(
    {
      redux: {
        patchSlice() {},
        refresh() {},
        patchThunk(name: string, callback: typeof wrap) {
          assert.equal(name, 'showNotification');
          wrap = callback;
        },
      },
      patchComponent() {},
    },
    config,
  );
  plugin.log = () => {};
  plugin.start();
  let received: any[] = [];
  const notify = wrap((...args: any[]) => {
    received = args;
    return 'notification';
  });
  const message = {
    text: 'a job',
    channel: 'C123',
    ts: '123.45',
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'job listing' } }],
  };
  const args = { message, teamId: 'T123', extra: 'kept' };
  assert.equal(notify(args, 'other argument'), 'notification');
  assert.deepEqual(received, [
    {
      ...args,
      message: {
        ...message,
        text: 'a ***',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*** listing' } }],
      },
    },
    'other argument',
  ]);
  assert.equal(message.text, 'a job');
  config.terms = 'listing';
  plugin.onSettingsChange();
  notify(args);
  const updated = received[0] as typeof args;
  assert.equal(updated.message.text, 'a job');
  assert.equal(updated.message.blocks[0].text.text, 'job *******');
  notify(undefined);
  assert.equal(received[0], undefined);
});
