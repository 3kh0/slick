import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  stdin: {
    contents: "export { setupSendChecks } from './src/app/api/sendChecks.tsx';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'slack-stubs',
      setup(stubs) {
        stubs.onResolve({ filter: /\/slack\/(blocks|webpack)\.ts$/ }, (args) => ({
          path: args.path,
          namespace: 'stub',
        }));
        stubs.onLoad({ filter: /blocks\.ts$/, namespace: 'stub' }, () => ({
          contents: 'export const fromDeltaNow = (ops) => [{ type: "text", text: ops.map(op => op.insert).join("") }];',
        }));
        stubs.onLoad({ filter: /webpack\.ts$/, namespace: 'stub' }, () => ({
          contents:
            'export const getExport = (matcher) => [globalThis.getInputProxy, globalThis.windowContext].find(exp => exp && matcher(exp));',
        }));
      },
    },
  ],
});
const { setupSendChecks } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

type TextChange = (change: unknown, old: unknown, source: string) => void;
const inputs = new WeakMap<object, unknown>();
let renderWindow = {};
let unmount = () => {};
(globalThis as any).getInputProxy = function getInputProxy({ targetWindow }: { targetWindow: object }) {
  return inputs.get(targetWindow);
};
(globalThis as any).windowContext = { displayName: 'WindowContext' };
(globalThis as any).React = {
  useCallback: (callback: unknown) => callback,
  useContext: () => ({ windowRef: new WeakRef(renderWindow) }),
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => () => void) => {
    unmount = effect();
  },
  createElement: (type: unknown, props: unknown) => ({ type, props }),
};

function composer({ found = true, readable = true, sendError = false } = {}) {
  renderWindow = {};
  const targetWindow = renderWindow;
  const listeners = new Set<TextChange>();
  let contents = [{ insert: 'hello\n' }];
  let files: string[] = [];
  let cleanups = 0;
  const sent: { text: string; files: string[]; args: unknown[] }[] = [];
  const input = {
    getContents: readable ? () => ({ contents }) : undefined,
    getContainer: () => ({
      __quill: {
        on: (_event: string, listener: TextChange) => listeners.add(listener),
        off: (_event: string, listener: TextChange) => listeners.delete(listener),
      },
    }),
  };
  // Slack returns the same Quill instance on each lookup.
  const container = input.getContainer();
  input.getContainer = () => container;
  if (found) inputs.set(targetWindow, input);
  let replace: any;
  const addSendCheck = setupSendChecks((name: string, replacer: unknown) => {
    assert.equal(name, 'MessageInput');
    replace = replacer;
    return () => {};
  });
  const text = () => contents.map((op) => op.insert).join('');
  const sendMessage = (...args: unknown[]) => {
    const message = { text: text(), files: [...files], args };
    contents = [];
    files = [];
    return Promise.resolve().then(() => {
      if (sendError) {
        contents = [{ insert: message.text }];
        files = message.files;
        throw Error('send failed');
      }
      sent.push(message);
      cleanups++;
      return 'sent';
    });
  };
  const send = replace(() => null)({ channelId: 'C1', threadTs: '123', viewContext: 'Thread', sendMessage }).props
    .sendMessage;
  const dispose = unmount;
  return {
    addSendCheck,
    send,
    sent,
    text,
    targetWindow,
    dispose,
    cleanups: () => cleanups,
    listenerCount: () => listeners.size,
    files: () => files,
    attach: (id: string) => {
      files.push(id);
    },
    replaceInput: () => inputs.set(targetWindow, {}),
    type(value: string, source = 'user') {
      contents = [{ insert: value }];
      for (const listener of listeners) listener(null, null, source);
    },
  };
}

const deferred = () => {
  let resolve!: (passed: boolean) => void;
  const promise = new Promise<boolean>((done) => (resolve = done));
  return { promise, resolve };
};

test('passing checks preserve the original send result and arguments', async () => {
  const slack = composer();
  slack.addSendCheck(() => true);
  const args = { fromKeyboardShortcut: true };
  assert.equal(await slack.send(args), 'sent');
  assert.deepEqual(slack.sent[0]?.args, [args]);
  assert.equal(slack.cleanups(), 1);
});

test('rejected checks leave text and attachments untouched', async () => {
  const slack = composer();
  slack.attach('F1');
  slack.addSendCheck(() => false);
  assert.equal(slack.send(), undefined);
  assert.equal(slack.text(), 'hello\n');
  assert.deepEqual(slack.files(), ['F1']);
  assert.equal(slack.sent.length, 0);
  assert.equal(slack.listenerCount(), 0);
});

test('async checks keep the original send lifecycle, including attachments that finish uploading while pending', async () => {
  const slack = composer();
  const check = deferred();
  slack.addSendCheck(() => check.promise);
  const sending = slack.send();
  assert.equal(slack.text(), 'hello\n');
  assert.equal(slack.cleanups(), 0);
  slack.attach('F_FINISHED_UPLOAD');
  check.resolve(true);
  assert.equal(await sending, 'sent');
  assert.deepEqual(slack.sent[0]?.files, ['F_FINISHED_UPLOAD']);
  assert.equal(slack.text(), '');
  assert.deepEqual(slack.files(), []);
  assert.equal(slack.cleanups(), 1);
  assert.equal(slack.listenerCount(), 0);
});

test('file-only drafts survive async rejection', async () => {
  const slack = composer();
  slack.type('\n');
  slack.attach('F1');
  slack.addSendCheck(async () => false);
  await slack.send();
  assert.equal(slack.text(), '\n');
  assert.deepEqual(slack.files(), ['F1']);
  assert.equal(slack.sent.length, 0);
  assert.equal(slack.listenerCount(), 0);
});

for (const undo of [false, true]) {
  test(`user edits cancel a pending send${undo ? ' even after undo' : ''}`, async () => {
    const slack = composer();
    const check = deferred();
    slack.addSendCheck(() => check.promise);
    const sending = slack.send();
    slack.type('changed\n');
    if (undo) slack.type('hello\n');
    check.resolve(true);
    await sending;
    assert.equal(slack.sent.length, 0);
    assert.equal(slack.text(), undo ? 'hello\n' : 'changed\n');
    assert.equal(slack.listenerCount(), 0);
  });
}

test('programmatic draft changes cancel a pending send', async () => {
  const slack = composer();
  const check = deferred();
  slack.addSendCheck(() => check.promise);
  const sending = slack.send();
  slack.type('different draft\n', 'api');
  check.resolve(true);
  await sending;
  assert.equal(slack.sent.length, 0);
});

test('sending again supersedes the previous pending decision', async () => {
  const slack = composer();
  const decisions = [deferred(), deferred()];
  let call = 0;
  slack.addSendCheck(() => decisions[call++]!.promise);
  const first = slack.send();
  const second = slack.send();
  decisions[0]!.resolve(true);
  await first;
  assert.equal(slack.sent.length, 0);
  decisions[1]!.resolve(true);
  await second;
  assert.equal(slack.sent.length, 1);
  assert.equal(slack.cleanups(), 1);
});

for (const invalidation of ['unmount', 'replacement'] as const) {
  test(`${invalidation} cancels a pending send`, async () => {
    const slack = composer();
    const check = deferred();
    slack.addSendCheck(() => check.promise);
    const sending = slack.send();
    if (invalidation === 'unmount') slack.dispose();
    else slack.replaceInput();
    check.resolve(true);
    await sending;
    assert.equal(slack.sent.length, 0);
    assert.equal(slack.listenerCount(), 0);
  });
}

test('checks see untransformed composer text and the originating window', async () => {
  const main = composer();
  const check = deferred();
  main.addSendCheck((blocks: { text: string }[], context: any) => {
    assert.equal(blocks[0]?.text, 'hello\n');
    assert.equal(context.channelId, 'C1');
    assert.equal(context.threadTs, '123');
    assert.equal(context.targetWindow, main.targetWindow);
    return check.promise;
  });
  const popout = composer();
  popout.type('another window\n');
  const sending = main.send();
  check.resolve(true);
  await sending;
  assert.equal(main.sent.length, 1);
  assert.equal(popout.text(), 'another window\n');
});

test('send failures propagate through the original composer recovery', async () => {
  const slack = composer({ sendError: true });
  slack.attach('F1');
  slack.addSendCheck(async () => true);
  await assert.rejects(slack.send(), /send failed/);
  assert.equal(slack.text(), 'hello\n');
  assert.deepEqual(slack.files(), ['F1']);
  assert.equal(slack.cleanups(), 0);
  assert.equal(slack.listenerCount(), 0);
});

test('checks short-circuit after rejection', async () => {
  const slack = composer();
  slack.addSendCheck(async () => false);
  slack.addSendCheck(() => assert.fail('Should not run'));
  await slack.send();
  assert.equal(slack.sent.length, 0);
});

test('broken checks are ignored and registrations remove only themselves', async (t) => {
  const errors: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => errors.push(args));
  const slack = composer();
  slack.addSendCheck(function throws() {
    throw Error('broken');
  });
  slack.addSendCheck(() => Promise.reject(Error('also broken')));
  const block = () => false;
  const remove = slack.addSendCheck(block);
  slack.addSendCheck(block);
  remove();
  await slack.send();
  assert.equal(slack.sent.length, 0);
  assert.equal(errors.length, 2);
  assert.match(String(errors[0]?.[0]), /send check throws \(#\d+/);
});

for (const options of [{ found: false }, { readable: false }]) {
  test(`unavailable composer data leaves Slack's send working (${JSON.stringify(options)})`, async () => {
    const slack = composer(options);
    slack.addSendCheck(() => assert.fail('No composer data'));
    assert.equal(await slack.send(), 'sent');
  });
}
