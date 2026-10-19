import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { build } from 'esbuild';

// Slack's converter and module registry are stubbed: the composer below
// stands in for the real one.
const bundle = await build({
  stdin: {
    contents:
      "export { setupSendChecks } from './src/app/api/sendChecks.tsx'; export { composedDeltas, setupMessageSendDelta } from './src/app/api/messageSend.tsx';",
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
          contents: 'export const fromDeltaNow = (delta) => [{ type: "text", text: delta.text }];',
        }));
        stubs.onLoad({ filter: /webpack\.ts$/, namespace: 'stub' }, () => ({
          contents:
            'export const getExport = (matcher) => [globalThis.getInputProxy, globalThis.windowContext].find((exp) => exp && matcher(exp));',
        }));
      },
    },
  ],
});
const { setupSendChecks, composedDeltas, setupMessageSendDelta } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

type TextChange = (change: unknown, old: unknown, source: string) => void;
type Delta = { ops: { insert: string }[]; text: string };
const delta = (text: string): Delta => ({ ops: [{ insert: `${text}\n` }], text });

let current: ReturnType<typeof composer> | undefined;
let renderWindow = {};
const inputs = new WeakMap<object, ReturnType<typeof composer>['input']>();
(globalThis as any).getInputProxy = function getInputProxy({ targetWindow }: { targetWindow?: object }) {
  return targetWindow ? inputs.get(targetWindow) : current?.input;
};
(globalThis as any).windowContext = { displayName: 'WindowContext' };
(globalThis as any).React = {
  useCallback: (callback: unknown) => callback,
  useContext: () => ({ windowRef: new WeakRef(renderWindow) }),
  createElement: (type: unknown, props: unknown) => ({ type, props }),
};

/** A composer whose sends behave like Slack's, plus the plugin API on top. */
function composer({ found = true, readable = true, restores = true, restoreDelay = 0 } = {}) {
  renderWindow = {};
  const listeners = new Set<TextChange>();
  let contents: { insert: string }[] = [];
  const emit = (source: string) => {
    for (const listener of listeners) listener(null, null, source);
  };
  const quill = {
    on: (_event: string, listener: TextChange) => listeners.add(listener),
    off: (_event: string, listener: TextChange) => listeners.delete(listener),
  };
  const input = {
    clear() {
      contents = [];
      emit('api');
    },
    isEmpty: () => !contents.length,
    getContents: readable ? () => ({ contents }) : undefined,
    setContents({ contents: next }: { contents: { insert: string }[] }) {
      contents = next;
      emit('api');
    },
    getContainer: () => ({ __quill: quill }),
  };
  const sent: Delta[] = [];
  if (found) inputs.set(renderWindow, input);
  const replacers: Record<string, (Original: unknown) => (props: unknown) => any> = {};
  const addSendCheck = setupSendChecks((name: string, replacer: (typeof replacers)[string]) => {
    replacers[name] = replacer;
    return () => {};
  });
  const wrap = (name: string, prepareAndSendMessage: (options: { delta: Delta }) => Promise<unknown>) =>
    replacers[name]!(() => null)({ channelId: 'C1', prepareAndSendMessage }).props.prepareAndSendMessage;
  let send = wrap('MessagePaneInput', async (options) => void sent.push(options.delta));
  const fixture = {
    input,
    sent,
    addSendCheck,
    listenerCount: () => listeners.size,
    text: () => contents.map((op) => op.insert).join(''),
    type(text: string) {
      contents = delta(text).ops;
      emit('user');
    },
    /** InputContainer passing its send on to MessagePaneInput's. */
    nest() {
      send = wrap('InputContainer', send);
    },
    /** What Slack does on Enter: empty the composer, send, put a rejected message back. */
    async enter(text = 'hello', message = delta(text)) {
      contents = [];
      emit('api');
      try {
        await send({ delta: message });
        return 'sent';
      } catch {
        for (let hop = 0; hop < restoreDelay; hop++) await Promise.resolve();
        if (restores && input.isEmpty()) input.setContents({ contents: message.ops });
        return 'held';
      }
    },
    /** Slack clearing the composer again a frame later, after deleting a draft. */
    wipe: () => input.clear(),
  };
  current = found ? fixture : undefined;
  return fixture;
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve!: (passed: boolean) => void;
  const promise = new Promise<boolean>((done) => (resolve = done));
  return { promise, resolve };
};

test('passing checks send at once and failing ones keep the message', async () => {
  const slack = composer();
  slack.addSendCheck((blocks: { text: string }[]) => blocks[0]!.text !== 'nope');
  assert.equal(await slack.enter('hello'), 'sent');
  assert.equal(slack.sent.length, 1);
  assert.equal(slack.text(), '');

  assert.equal(await slack.enter('nope'), 'held');
  slack.wipe();
  assert.equal(slack.text(), 'nope\n');
  assert.equal(slack.sent.length, 1);
});

test('an async check that passes before Slack puts the message back still sends it once', async () => {
  const slack = composer({ restoreDelay: 5 });
  slack.addSendCheck(async () => true);
  assert.equal(await slack.enter('hello'), 'held');
  await flush();
  assert.deepEqual(
    slack.sent.map((message) => message.text),
    ['hello'],
  );
  assert.equal(slack.text(), '');
});

test('a passed message Slack never puts back goes out when the hold ends', async (t: TestContext) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const slack = composer({ restores: false });
  slack.addSendCheck(async () => true);
  assert.equal(await slack.enter('hello'), 'held');
  await flush();
  assert.equal(slack.sent.length, 0);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(slack.sent.length, 1);
});

test('an async check that passes after the user edits sends nothing', async () => {
  const slack = composer();
  const check = deferred();
  slack.addSendCheck(() => check.promise);
  assert.equal(await slack.enter('hello'), 'held');
  slack.type('hello there');
  check.resolve(true);
  await flush();
  assert.equal(slack.sent.length, 0);
  assert.equal(slack.text(), 'hello there\n');
});

test('an async check that passes after confirmation sends the held message', async () => {
  const slack = composer();
  const check = deferred();
  slack.addSendCheck(() => check.promise);
  assert.equal(await slack.enter('hello'), 'held');
  slack.wipe();
  assert.equal(slack.text(), 'hello\n');
  check.resolve(true);
  await flush();
  assert.equal(slack.sent.length, 1);
  assert.equal(slack.text(), '');
});

test('sending a held message again sends it once, from the later decision', async () => {
  const slack = composer();
  const decisions = [deferred(), deferred()];
  let call = 0;
  slack.addSendCheck(() => decisions[call++]!.promise);
  assert.equal(await slack.enter('hello'), 'held');
  assert.equal(await slack.enter('hello'), 'held');
  assert.equal(slack.text(), 'hello\n');
  decisions[0]!.resolve(true);
  await flush();
  assert.equal(slack.sent.length, 0);
  decisions[1]!.resolve(true);
  await flush();
  assert.equal(slack.sent.length, 1);
  assert.equal(slack.text(), '');
});

test('a send passing through both composers is checked once', async () => {
  const slack = composer();
  let runs = 0;
  const check = deferred();
  slack.addSendCheck(() => {
    runs++;
    return check.promise;
  });
  slack.nest();
  assert.equal(await slack.enter('hello'), 'held');
  check.resolve(true);
  await flush();
  assert.equal(runs, 1);
  assert.equal(slack.sent.length, 1);
});

test('checks read what the user wrote, before Delta transforms', async () => {
  const slack = composer();
  const seen: string[] = [];
  slack.addSendCheck((blocks: { text: string }[]) => {
    seen.push(blocks[0]!.text);
    return true;
  });
  const written = delta('hello');
  const transformed = delta('HELLO');
  composedDeltas.set(transformed, written);
  assert.equal(await slack.enter('', transformed), 'sent');
  assert.deepEqual(seen, ['hello']);
  assert.equal(slack.sent[0], transformed);
});

for (const checksFirst of [false, true]) {
  test(`nested composers check the original once (checks registered ${checksFirst ? 'first' : 'last'})`, async () => {
    current = undefined;
    const patches = new Map<string, ((original: unknown) => (props: any) => any)[]>();
    const patch = (name: string, replace: any) => {
      patches.set(name, [...(patches.get(name) ?? []), replace]);
      return () => {};
    };
    const first = (checksFirst ? setupSendChecks : setupMessageSendDelta)(patch);
    const second = (checksFirst ? setupMessageSendDelta : setupSendChecks)(patch);
    const [check, transform] = checksFirst ? [first, second] : [second, first];
    transform((message: Delta) => delta(message.text.toUpperCase()));
    const seen: string[] = [];
    check((blocks: { text: string }[]) => {
      seen.push(blocks[0]!.text);
      return true;
    });
    const wrap = (name: string, send: any) => {
      let props = { channelId: 'C1', prepareAndSendMessage: send };
      for (const replace of patches.get(name)!.toReversed()) props = replace(() => null)(props).props;
      return props.prepareAndSendMessage;
    };
    const sent: Delta[] = [];
    const send = wrap(
      'InputContainer',
      wrap('MessagePaneInput', async ({ delta: message }: { delta: Delta }) => sent.push(message)),
    );
    await send({ delta: delta('hello') });
    assert.deepEqual(seen, ['hello']);
    assert.equal(sent.length, 1);
  });
}

test('editing a held message after the restoration window cancels its pending send', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const slack = composer(),
    check = deferred();
  slack.addSendCheck(() => check.promise);
  await slack.enter('hello');
  t.mock.timers.tick(1000);
  slack.type('changed');
  slack.type('hello');
  check.resolve(true);
  await flush();
  assert.equal(slack.sent.length, 0);
  assert.equal(slack.text(), 'hello\n');
});

for (const asynchronous of [false, true]) {
  test(`a rejected ${asynchronous ? 'async' : 'sync'} check removes its hold listener`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const slack = composer();
    const check = deferred();
    slack.addSendCheck(() => (asynchronous ? check.promise : false));
    await slack.enter();
    t.mock.timers.tick(1000);
    if (asynchronous) {
      assert.equal(slack.listenerCount(), 1);
      check.resolve(false);
      await flush();
    }
    assert.equal(slack.listenerCount(), 0);
    assert.equal(slack.sent.length, 0);
    assert.equal(slack.text(), 'hello\n');
  });
}

test('a confirmation holds only the sending window when the same thread is also popped out', async () => {
  const main = composer();
  const check = deferred();
  main.addSendCheck(() => check.promise);
  const popout = composer();
  popout.type('different draft');
  assert.equal(await main.enter('hello'), 'held');
  check.resolve(true);
  await flush();
  assert.equal(main.sent.length, 1);
  assert.equal(main.text(), '');
  assert.equal(popout.text(), 'different draft\n');
});

for (const [name, options] of [
  ['without a composer', { found: false }],
  ['with a composer it cannot read', { readable: false }],
] as const) {
  test(`${name} to hold it in, the send waits for the checks`, async () => {
    const slack = composer(options);
    const checks = [true, false];
    slack.addSendCheck(async () => checks.shift());
    assert.equal(await slack.enter('hello'), 'sent');
    assert.equal(await slack.enter('nope'), 'held');
    assert.equal(slack.sent.length, 1);
  });
}

test('broken checks are ignored, and each registration removes only itself', async (t: TestContext) => {
  const errors: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => errors.push(args));
  const slack = composer();
  slack.addSendCheck(function throws() {
    throw new Error('broken');
  });
  slack.addSendCheck(() => Promise.reject(new Error('also broken')));
  const block = () => false;
  const remove = slack.addSendCheck(block);
  slack.addSendCheck(block);
  remove();
  assert.equal(await slack.enter('hello'), 'held');
  assert.match(String(errors[0]![0]), /send check throws \(#\d+/);

  current = undefined;
  const open = composer();
  open.addSendCheck(function throws() {
    throw new Error('broken');
  });
  assert.equal(await open.enter('hello'), 'sent');
});
