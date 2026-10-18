import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compactDictionary, dictionaryLookup, estimateSyllables } from './haiku.ts';

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

test('compacted dictionary gives every word the same count', () => {
  const compact = compactDictionary(dictionary);
  assert.ok(compact.length < dictionary.length / 5);
  for (const line of dictionary.trimEnd().split('\n')) {
    const word = line.slice(0, line.lastIndexOf(' '));
    assert.equal(dictionaryLookup(compact, word) ?? estimateSyllables(word), dictionaryLookup(dictionary, word), word);
  }
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

test('reported quoted message produces the exact haiku Orpheus posted', async () => {
  const { blocksToSlackText, findHaiku } = await import('./haiku.ts');
  const text = blocksToSlackText([
    {
      type: 'rich_text',
      elements: [
        { type: 'rich_text_quote', elements: [{ type: 'text', text: 'I’m complex.' }] },
        {
          type: 'rich_text_section',
          elements: [{ type: 'text', text: 'ah, that explains my confusion when I was at best' }],
        },
      ],
    },
  ]);
  assert.equal(text, '&gt; I’m complex.\nah, that explains my confusion when I was at best');
  assert.deepEqual(
    findHaiku(text, (word) => dictionaryLookup(dictionary, word)),
    ['gt im complex. ah', 'that explains my confusion', 'when i was at best'],
  );
});

test('dictionary decoding is skipped for excluded or long messages and failures do not block sending', async () => {
  let decodes = 0;
  let sends = 0;
  let failures = 0;
  const plugin = new HaikuWarning(
    {
      blocks: { fromDelta: async (delta: any) => [{ type: 'text', text: delta.ops[0].insert }] },
    },
    {},
  );
  plugin.dictionary = async () => {
    decodes++;
    throw new Error('invalid dictionary');
  };
  plugin.log = () => failures++;
  const props = { prepareAndSendMessage: async () => sends++ };
  await plugin.onSend(props, { channelId: 'C09MATKQM8C', delta: { ops: [{ insert: 'hello' }] } });
  await plugin.onSend(props, { delta: { ops: [{ insert: 'x'.repeat(300) }] } });
  assert.equal(decodes, 0);
  await plugin.onSend(props, { delta: { ops: [{ insert: 'hello' }] } });
  assert.equal(decodes, 1);
  assert.equal(failures, 1);
  assert.equal(sends, 3);
});

test('deactivation during detection and unavailable modals never hold a send', async () => {
  let active = true;
  let release!: (value: string[]) => void;
  let sends = 0;
  let prompts = 0;
  const controller = new AbortController();
  const plugin = new HaikuWarning({ signal: controller.signal, isActive: () => active }, {});
  plugin.findHaiku = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  plugin.ask = () => {
    prompts++;
    return false;
  };
  const props = { prepareAndSendMessage: async () => sends++ };
  const args = { delta: { ops: [{ insert: 'haiku' }] } };
  const pending = plugin.onSend(props, args);
  active = false;
  release(['five', 'seven', 'five']);
  await pending;
  assert.equal(sends, 1);
  assert.equal(prompts, 0);
  active = true;
  plugin.findHaiku = async () => ['five', 'seven', 'five'];
  await plugin.onSend(props, args);
  assert.equal(prompts, 1);
  assert.equal(sends, 2);
  controller.abort();
  await plugin.onSend(props, args);
  assert.equal(prompts, 1);
  assert.equal(sends, 3);
});
