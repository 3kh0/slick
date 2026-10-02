import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanUrl, compileExtraRules } from './clean.ts';
import { cleanPastedOps, patchClipboard, type ClipboardPrototype, type PasteOp } from './paste.ts';

const dirty = 'https://example.test/page?id=3&utm_source=slack';
const clean = 'https://example.test/page?id=3';
const cleanLink = (url: string) => cleanUrl(url, [], compileExtraRules('utm_source'));

test('paste cleaning preserves labels, attributes, embeds and the original clipboard ops', () => {
  const ops = [
    { insert: dirty, attributes: { link: dirty, bold: true } },
    { insert: 'custom label', attributes: { link: dirty } },
    { insert: dirty.replace('https://', ''), attributes: { link: dirty } },
    { insert: { image: 'attachment' } },
    { insert: ` see ${dirty}.` },
  ];
  const original = structuredClone(ops);
  const result = cleanPastedOps(ops, cleanLink)!;
  assert.deepEqual(result, [
    { insert: clean, attributes: { link: clean, bold: true } },
    { insert: 'custom label', attributes: { link: clean } },
    { insert: clean.replace('https://', ''), attributes: { link: clean } },
    ops[3],
    { insert: ` see ${clean}.` },
  ]);
  assert.deepEqual(ops, original);
  assert.equal(cleanPastedOps(result, cleanLink), null);
});

test('code formatting, newline code-block attributes and Markdown code stay literal', () => {
  const ops = [
    { insert: `${dirty}\n` },
    { insert: dirty, attributes: { code: true, link: dirty } },
    { insert: '\n' },
    { insert: dirty },
    { insert: '\n', attributes: { 'code-block': true } },
    { insert: `outside ${dirty} \`${dirty}\`\n\`\`\`\n${dirty}\n\`\`\`\nafter ${dirty}` },
  ];
  const result = cleanPastedOps(ops, cleanLink)!;
  assert.equal(result[0].insert, `${clean}\n`);
  assert.equal(result[1], ops[1]);
  assert.equal(result[3], ops[3]);
  assert.equal(result[5].insert, `outside ${clean} \`${dirty}\`\n\`\`\`\n${dirty}\n\`\`\`\nafter ${clean}`);
  assert.equal(cleanPastedOps([{ insert: `\`\`\`\n${dirty}` }], cleanLink), null);
});

test('Markdown links keep labels and deliberately unlinked text stays unchanged', () => {
  const ops = [
    { insert: `<${dirty}|label> [custom label](${dirty})` },
    { insert: dirty, attributes: { unlink: true } },
  ];
  const result = cleanPastedOps(ops, cleanLink)!;
  assert.equal(result[0].insert, `<${clean}|label> [custom label](${clean})`);
  assert.equal(result[1], ops[1]);
});

class Delta {
  ops: PasteOp[];
  constructor(ops: PasteOp[]) {
    this.ops = ops;
  }
}

test('clipboard hook passes a real Delta, respects destination code, and restores on disable', () => {
  let received: unknown;
  const proto: ClipboardPrototype = {
    preparePastedDelta(args) {
      received = args;
      return 'inserted';
    },
  };
  const original = proto.preparePastedDelta;
  const dispose = patchClipboard(proto, cleanLink);
  const input = { pastedDelta: new Delta([{ insert: dirty }]) };
  assert.equal(proto.preparePastedDelta.call({}, input), 'inserted');
  const output = received as typeof input;
  assert.ok(output.pastedDelta instanceof Delta);
  assert.equal(output.pastedDelta.ops[0].insert, clean);
  assert.equal(input.pastedDelta.ops[0].insert, dirty);
  const code = { ...input, formats: { 'code-block': true } };
  proto.preparePastedDelta.call({}, code);
  assert.equal(received, code);
  dispose();
  assert.equal(proto.preparePastedDelta, original);
});

test('intercepted Markdown is cleaned and callback restoration survives exceptions', () => {
  let received = '';
  const handler = ({ markdownText }: { markdownText: string }) => {
    received = markdownText;
  };
  const clipboard = { options: { onMarkdownPasteIntercepted: handler } };
  const proto: ClipboardPrototype = {
    preparePastedDelta() {},
    maybeInterceptMarkdownPaste(event) {
      this.options!.onMarkdownPasteIntercepted!({ markdownText: `[label](${dirty})` });
      if (event === 'throw') throw new Error('conversion failed');
      return true;
    },
  };
  const dispose = patchClipboard(proto, cleanLink);
  assert.equal(proto.maybeInterceptMarkdownPaste!.call(clipboard, null), true);
  assert.equal(received, `[label](${clean})`);
  assert.equal(clipboard.options.onMarkdownPasteIntercepted, handler);
  assert.throws(() => proto.maybeInterceptMarkdownPaste!.call(clipboard, 'throw'), /conversion failed/);
  assert.equal(clipboard.options.onMarkdownPasteIntercepted, handler);
  proto.maybeInterceptMarkdownPaste!.call(clipboard, null, false, { code: true });
  assert.equal(received, `[label](${dirty})`);
  dispose();
});

test('a later clipboard patch is retained while a disposed cleaner becomes inert', () => {
  let received: any;
  const proto: ClipboardPrototype = {
    preparePastedDelta(args) {
      received = args;
    },
  };
  const dispose = patchClipboard(proto, cleanLink);
  const wrapped = proto.preparePastedDelta;
  const later: ClipboardPrototype['preparePastedDelta'] = function (args) {
    return wrapped.call(this, args);
  };
  proto.preparePastedDelta = later;
  dispose();
  assert.equal(proto.preparePastedDelta, later);
  proto.preparePastedDelta.call({}, { pastedDelta: new Delta([{ insert: dirty }]) });
  assert.equal(received.pastedDelta.ops[0].insert, dirty);
});
