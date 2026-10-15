import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createThunkPatches } from './thunkPatches.ts';

test('named hooks skip unrelated creators and preserve receiver, arguments and return value', () => {
  const patches = createThunkPatches();
  const receiver = {};
  const original = Object.assign(
    function (this: unknown, ...args: unknown[]) {
      assert.equal(this, receiver);
      return args;
    },
    { meta: { name: 'readChannel' } },
  );
  patches.patch('sendMessage', () => {
    throw new Error('unrelated hook');
  });
  const wrapped = patches.wrapCreator(original);
  assert.deepEqual(wrapped.call(receiver, 1, 'two', null), [1, 'two', null]);
  assert.equal((wrapped as any).meta, original.meta);
});

test('named and predicate hooks compose in registration order and predicates stay live', () => {
  const patches = createThunkPatches();
  const original = Object.assign(() => 'original', { meta: { name: 'send' } });
  const wrapped = patches.wrapCreator(original);
  const wrap = (label: string) => (fn: () => string) => () => `${label}(${fn()})`;
  let enabled = true;
  let predicateCalls = 0;
  patches.patch('send', wrap('first'));
  const remove = patches.patch((creator) => {
    assert.equal(creator, original);
    predicateCalls++;
    return enabled;
  }, wrap('second'));
  patches.patch('send', wrap('third'));
  assert.equal(wrapped(), 'third(second(first(original)))');
  enabled = false;
  assert.equal(wrapped(), 'third(first(original))');
  assert.equal(predicateCalls, 2);
  remove();
  remove();
  assert.equal(wrapped(), 'third(first(original))');
  assert.equal(predicateCalls, 2);
});

test('metadata assigned after creation, renamed thunks, and plugin restarts take effect immediately', () => {
  const patches = createThunkPatches();
  const original: any = () => 'raw';
  const wrapped = patches.wrapCreator(original);
  const remove = patches.patch('send', () => () => 'patched');
  assert.equal(wrapped(), 'raw');
  original.meta = { name: 'send' };
  assert.equal(wrapped(), 'patched');
  original.meta.name = 'read';
  assert.equal(wrapped(), 'raw');
  original.meta.name = 'send';
  remove();
  assert.equal(wrapped(), 'raw');
  const stop = patches.patch('send', () => () => 'restarted');
  remove();
  assert.equal(wrapped(), 'restarted');
  stop();
  assert.equal(wrapped(), 'raw');
});

test('wrappers are rebuilt each call so settings captured by their factories remain live', () => {
  const patches = createThunkPatches();
  let setting = 1;
  patches.patch('send', () => {
    const captured = setting;
    return () => captured;
  });
  const wrapped = patches.wrapCreator(Object.assign(() => 0, { meta: { name: 'send' } }));
  assert.equal(wrapped(), 1);
  setting = 2;
  assert.equal(wrapped(), 2);
});

test('a throwing metadata getter or predicate does not suppress other hooks', () => {
  const patches = createThunkPatches();
  const original = Object.defineProperty(() => 'raw', 'meta', {
    get() {
      throw new Error('not ready');
    },
  });
  patches.patch('send', () => () => 'wrong');
  patches.patch(
    () => {
      throw new Error('failed predicate');
    },
    () => () => 'wrong',
  );
  patches.patch(
    () => true,
    (fn) => () => `ok(${fn()})`,
  );
  assert.equal(patches.wrapCreator(original)(), 'ok(raw)');
});

test('hooks removed or added by a running hook take effect in registration order', () => {
  const patches = createThunkPatches();
  const calls: string[] = [];
  let first = true;
  let removeLater = () => {};
  patches.patch('send', (original) => {
    calls.push('first');
    if (first) {
      first = false;
      removeLater();
      patches.patch('send', (fn) => {
        calls.push('added');
        return fn;
      });
    }
    return original;
  });
  removeLater = patches.patch('send', (original) => {
    calls.push('removed');
    return original;
  });
  patches.patch(
    () => true,
    (original) => {
      calls.push('predicate');
      return original;
    },
  );
  const wrapped = patches.wrapCreator(Object.assign(() => 'raw', { meta: { name: 'send' } }));
  assert.equal(wrapped(), 'raw');
  assert.deepEqual(calls, ['first', 'predicate', 'added']);
});

test('the first named hook registered by a predicate takes effect in the same invocation', () => {
  const patches = createThunkPatches();
  let first = true;
  let metadataReads = 0;
  const original = Object.defineProperty(() => 'raw', 'meta', {
    get() {
      metadataReads++;
      return { name: 'send' };
    },
  });
  patches.patch(
    () => {
      if (first) {
        first = false;
        assert.equal(metadataReads, 0, 'predicate-only invocations need no initial metadata read');
        patches.patch('send', () => () => 'patched');
      }
      return false;
    },
    () => {
      throw new Error('unmatched predicate must not wrap');
    },
  );
  const wrapped = patches.wrapCreator(original);
  assert.equal(wrapped(), 'patched');
  assert.equal(metadataReads, 1);
  assert.equal(wrapped(), 'patched');
  assert.equal(metadataReads, 2);
});
