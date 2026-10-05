import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { build } from 'esbuild';
import { dictionaryLookup } from './haiku.ts';

const dictionary = await readFile(new URL('./syllable_counts.txt', import.meta.url), 'utf8');
const bundle = await build({
  entryPoints: [new URL('./index.tsx', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  loader: { '.txt': 'text' },
});
const { default: HaikuWarning } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

test('offline dictionary matches the pinned Orpheus data', () => {
  assert.equal(
    createHash('sha256').update(dictionary).digest('hex'),
    'f8f04665147e96cb87d272e464f508b543b80031dfa3b373ccfbdfe2779a3ca6',
  );
  assert.equal(dictionaryLookup(dictionary, 'silence'), 2);
  assert.equal(dictionaryLookup(dictionary, 'again'), 2);
});

test('offline warning holds a haiku, permits editing and sends only after approval', async () => {
  const previousReact = (globalThis as any).React;
  (globalThis as any).React = { createElement: (...args: unknown[]) => args, Fragment: 'fragment' };
  try {
    let modal: any;
    let sends = 0;
    let clears = 0;
    let closes = 0;
    const patches: string[] = [];
    const controller = new AbortController();
    const plugin = new HaikuWarning(
      {
        signal: controller.signal,
        // Deliberately no fetch/storage: extension and offline desktop must work without them.
        patchComponent: (name: string) => patches.push(name),
        blocks: { fromDelta: async (delta: any) => [{ type: 'text', text: delta.ops[0].insert }] },
        elements: { MrkdwnElement: () => null },
        modal: {
          openModal: (options: any) => {
            modal = options;
            return { close: () => closes++ };
          },
        },
        getExport: () => () => ({ clear: () => clears++ }),
      },
      {},
    );
    plugin.start();
    assert.deepEqual(patches, ['MessagePaneInput', 'InputContainer']);
    const props = {
      prepareAndSendMessage: async () => {
        sends++;
      },
    };
    const args = {
      channelId: 'CTEST',
      delta: { ops: [{ insert: 'An old silent pond, a frog jumps into the pond — splash, silence again.' }] },
    };
    await assert.rejects(plugin.onSend(props, args), /waiting for confirmation/);
    assert.equal(sends, 0);
    assert.equal(modal.cancelText, 'Keep editing');
    modal.onCancel();
    assert.equal(sends, 0);
    await assert.rejects(plugin.onSend(props, args), /waiting for confirmation/);
    modal.onSubmit();
    assert.equal(sends, 1);
    assert.equal(clears, 1);
    await plugin.onSend(props, { ...args, delta: { ops: [{ insert: 'hello' }] } });
    await plugin.onSend(props, { ...args, channelId: 'C09MATKQM8C' });
    assert.equal(sends, 3);
    await assert.rejects(plugin.onSend(props, args), /waiting for confirmation/);
    plugin.stop();
    assert.equal(closes, 1);
    controller.abort();
    modal.onSubmit();
    assert.equal(sends, 3);
  } finally {
    (globalThis as any).React = previousReact;
  }
});
