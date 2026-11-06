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
  plugins: [
    {
      name: 'dialog-harness',
      setup(builder) {
        builder.onLoad({ filter: /\/dialog\.ts$/ }, () => ({
          contents: 'export const openHaikuDialog = (...args) => globalThis.openTestDialog(...args);',
          loader: 'js',
        }));
      },
    },
  ],
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

test('send check waits for a visible warning, supports cancel and approval, and cleans up', async () => {
  const globals = globalThis as any;
  const previous = globals.openTestDialog;
  const owner = {};
  const prompts: { settle: (approved: boolean) => void; close: () => void }[] = [];
  const controller = new AbortController();
  let check: any;
  globals.openTestDialog = (doc: unknown, haiku: string[], settle: (approved: boolean) => void) => {
    assert.equal(doc, owner);
    assert.equal(haiku.length, 3);
    const prompt = { settle, close: () => settle(false) };
    prompts.push(prompt);
    return prompt;
  };
  const plugin = new HaikuWarning(
    {
      signal: controller.signal,
      addSendCheck: (fn: any) => {
        check = fn;
      },
    },
    {},
  );
  const context = { channelId: 'CTEST', targetWindow: { document: owner } };
  const blocks = [{ type: 'text', text: 'An old silent pond, a frog jumps into the pond — splash, silence again.' }];
  const untilPrompt = async (count: number) => {
    for (let i = 0; i < 50 && prompts.length < count; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(prompts.length, count);
  };
  try {
    plugin.start();
    let settled = false;
    const first = check(blocks, context).then((value: boolean) => {
      settled = true;
      return value;
    });
    await untilPrompt(1);
    assert.equal(settled, false);
    prompts[0]!.settle(false);
    assert.equal(await first, false);
    const second = check(blocks, context);
    await untilPrompt(2);
    prompts[1]!.settle(true);
    assert.equal(await second, true);
    assert.equal(await check([{ type: 'text', text: 'hello' }], context), true);
    assert.equal(await check(blocks, { ...context, channelId: 'C09MATKQM8C' }), true);
    const third = check(blocks, context);
    await untilPrompt(3);
    const fourth = check(blocks, context);
    await untilPrompt(4);
    assert.equal(await third, false);
    controller.abort();
    assert.equal(await fourth, false);
    prompts[3]!.settle(true);
    assert.equal(prompts.length, 4);
  } finally {
    plugin.stop();
    globals.openTestDialog = previous;
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

test('excluded and long messages skip decoding; detection and dialog failures permit sending', async () => {
  const globals = globalThis as any;
  const previous = globals.openTestDialog;
  let decodes = 0;
  let failures = 0;
  const plugin = new HaikuWarning({ signal: new AbortController().signal }, {});
  plugin.dictionary = async () => {
    decodes++;
    throw new Error('invalid dictionary');
  };
  plugin.log = () => failures++;
  const context = { channelId: 'CTEST', targetWindow: { document: {} } };
  assert.equal(await plugin.check([{ type: 'text', text: 'hello' }], { ...context, channelId: 'C09MATKQM8C' }), true);
  assert.equal(await plugin.check([{ type: 'text', text: 'x'.repeat(300) }], context), true);
  assert.equal(decodes, 0);
  assert.equal(await plugin.check([{ type: 'text', text: 'hello' }], context), true);
  assert.equal(decodes, 1);
  assert.equal(failures, 1);
  plugin.findHaiku = async () => ['five', 'seven', 'five'];
  globals.openTestDialog = () => {
    throw new Error('dialog unavailable');
  };
  try {
    assert.equal(await plugin.check([], context), true);
    assert.equal(failures, 2);
  } finally {
    globals.openTestDialog = previous;
  }
});

test('deactivation during detection never opens a warning', async () => {
  let release!: (value: string[]) => void;
  const controller = new AbortController();
  const plugin = new HaikuWarning({ signal: controller.signal }, {});
  plugin.findHaiku = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = plugin.check([], { channelId: 'CTEST' });
  controller.abort();
  release(['five', 'seven', 'five']);
  assert.equal(await pending, true);
});
