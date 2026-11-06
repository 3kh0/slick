import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('./rtm.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'Rtm',
  plugins: [
    {
      name: 'capture-rtm-hooks',
      setup(bundler) {
        bundler.onResolve({ filter: /^\.\/(redux|webpack)\.ts$/ }, (args) => ({
          path: args.path,
          namespace: 'hooks',
        }));
        bundler.onLoad({ filter: /.*/, namespace: 'hooks' }, () => ({
          contents: `
            export const patchExportFunction = (name, wrap) => globalThis.hooks[name] = wrap;
            export const patchThunk = patchExportFunction;
          `,
        }));
      },
    },
  ],
});

function fixture() {
  const errors: unknown[][] = [];
  const context = createContext({
    hooks: {},
    console: { error: (...args: unknown[]) => errors.push(args) },
  });
  runInContext(bundle.outputFiles[0].text, context);
  return { on: context.Rtm.onRtmEvent, hooks: context.hooks, errors };
}

test('unsubscribed routing forwards native arguments and results without inspecting events', () => {
  const { hooks } = fixture();
  const batch = {
    get messages(): never {
      throw Error('Unused batch was inspected');
    },
  };
  const event = {
    get type(): never {
      throw Error('Unused event was inspected');
    },
  };
  for (const [name, input] of [
    ['routeMessages', batch],
    ['handleMessageImmediatelyWithoutPreprocessing', event],
  ] as const) {
    const result = {};
    const extra = {};
    const wrapped = hooks[name]((...args: unknown[]) => {
      assert.deepEqual(args, [input, extra]);
      return result;
    });
    assert.equal(wrapped(input, extra), result);
    const failure = Error('Native failure');
    assert.throws(
      () =>
        hooks[name](() => {
          throw failure;
        })(input),
      (error) => error === failure,
    );
  }
});

test('routed events notify distinct wildcard, routed, type and subtype keys before native routing', () => {
  const { on, hooks } = fixture();
  const calls: string[] = [];
  const event = { type: 'message', subtype: 'message_deleted' };
  for (const key of ['*', 'deleted', 'message', 'message_deleted'])
    on(key, (received: unknown) => {
      assert.equal(received, event);
      calls.push(key);
    });
  const route = hooks.routeMessages(() => calls.push('native'));
  route({ messages: { rtmEventType: 'deleted', msgs: [event] } });
  assert.deepEqual(calls, ['*', 'deleted', 'message', 'message_deleted', 'native']);
  calls.length = 0;
  route({ messages: { rtmEventType: 'message', msgs: [event] } });
  assert.deepEqual(calls, ['*', 'message', 'message_deleted', 'native']);
});

test('first subscription activates both routes and last disposal restores the inactive path', () => {
  const { on, hooks } = fixture();
  const calls: unknown[] = [];
  const route = hooks.routeMessages(() => {});
  const immediate = hooks.handleMessageImmediatelyWithoutPreprocessing(() => {});
  const event = { type: 'message', subtype: 'message_deleted' };
  const off = on('message_deleted', (value: unknown) => calls.push(value));
  route({ messages: { msgs: [event] } });
  immediate(event);
  assert.deepEqual(calls, [event, event]);
  off();
  route({
    get messages(): never {
      throw Error('Inactive batch inspected');
    },
  });
  immediate({
    get type(): never {
      throw Error('Inactive event inspected');
    },
  });
  assert.equal(calls.length, 2);
});

test('an old disposer cannot remove a newly registered listener for the same event type', () => {
  const { on, hooks } = fixture();
  let calls = 0;
  const listener = () => calls++;
  const off = on('message', listener);
  off();
  const removeCurrent = on('message', listener);
  off();
  hooks.routeMessages(() => {})({ messages: { msgs: [{ type: 'message' }] } });
  assert.equal(calls, 1);
  removeCurrent();
});

test('listener errors are isolated and delivery snapshots survive subscription changes', () => {
  const { on, hooks, errors } = fixture();
  const calls: string[] = [];
  let removeSecond = () => {};
  on('message', () => {
    calls.push('first');
    removeSecond();
    on('message', third);
    throw Error('Plugin failed');
  });
  removeSecond = on('message', () => calls.push('second'));
  function third() {
    calls.push('third');
  }
  const route = hooks.routeMessages(() => calls.push('native'));
  route({ messages: { msgs: [{ type: 'message' }, { type: 'message' }] } });
  assert.deepEqual(calls, ['first', 'second', 'first', 'third', 'native']);
  assert.equal(errors.length, 2);
});
