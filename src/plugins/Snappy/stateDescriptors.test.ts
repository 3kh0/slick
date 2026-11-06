import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeStateGatePatcher, type NativeStateGateOptions } from './stateDescriptors.ts';

const toggles = {
  ReduxSharedStateDescriptors: 'redux_shared_state_descriptors',
  HotPathStableShapes: 'hot_path_stable_shapes',
};
const both = { sharedStateDescriptors: true, stableSelectorShapes: true };

function gate(
  kind: keyof typeof toggles = 'ReduxSharedStateDescriptors',
  readGate: (name: string, receiver: unknown, args: unknown[]) => unknown = () => false,
) {
  const name =
    kind === 'ReduxSharedStateDescriptors' ? 'shouldShareReduxStateDescriptors' : 'shouldUseHotPathStableShapes';
  return new Function(
    'readGate',
    'toggles',
    `return function ${name}(...args) {
      return readGate(toggles.${kind}, this, args);
    }`,
  )(readGate, toggles) as (...args: any[]) => any;
}

function patch(options: NativeStateGateOptions, namespace: any): any {
  return createNativeStateGatePatcher(options)(namespace) ?? namespace;
}

test('boot choices independently enable only the two recognized gates and are snapshotted', () => {
  for (const sharedStateDescriptors of [false, true]) {
    for (const stableSelectorShapes of [false, true]) {
      const source = { gates: toggles, shared: gate(), stable: gate('HotPathStableShapes'), other: () => false };
      const options = { sharedStateDescriptors, stableSelectorShapes };
      const patcher = createNativeStateGatePatcher(options);
      options.sharedStateDescriptors = !sharedStateDescriptors;
      options.stableSelectorShapes = !stableSelectorShapes;
      const namespace = patcher(source) ?? source;
      assert.equal(namespace.shared(), sharedStateDescriptors);
      assert.equal(namespace.stable(), stableSelectorShapes);
      assert.equal(namespace.shared.name, source.shared.name);
      assert.equal(namespace.stable.name, source.stable.name);
      assert.equal(namespace.other, source.other);
      if (!sharedStateDescriptors) assert.equal(namespace.shared, source.shared);
      if (!stableSelectorShapes) assert.equal(namespace.stable, source.stable);
      assert.equal(source.shared(), false);
      assert.equal(source.stable(), false);
    }
  }
});

test('both disabled performs no namespace inspection or export wrapping', () => {
  const patcher = createNativeStateGatePatcher({ sharedStateDescriptors: false, stableSelectorShapes: false });
  const source = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error('namespace was inspected');
      },
    },
  );
  assert.equal(patcher(source), undefined);
  assert.equal(patcher(null), undefined);
});

test('an unselected gate preserves its receiver, arguments, return values and exceptions', () => {
  const receiver = {};
  const value = {};
  const failure = new Error('native gate failed');
  let throwNext = false;
  const original = gate('ReduxSharedStateDescriptors', (name, seenReceiver, args) => {
    assert.equal(name, toggles.ReduxSharedStateDescriptors);
    assert.equal(seenReceiver, receiver);
    assert.deepEqual(args, [value, 42]);
    if (throwNext) throw failure;
    return value;
  });
  const namespace = patch(
    { sharedStateDescriptors: false, stableSelectorShapes: true },
    { gates: toggles, native: original, selected: gate('HotPathStableShapes') },
  );
  assert.equal(namespace.native, original);
  assert.equal(namespace.native.call(receiver, value, 42), value);
  throwNext = true;
  assert.throws(
    () => namespace.native.call(receiver, value, 42),
    (error) => error === failure,
  );
  assert.equal(namespace.selected(), true);
});

test('namespace cloning preserves prototype, frozen descriptors and unrelated live exports', () => {
  const prototype = { inherited: 'kept' };
  const symbol = Symbol('namespace');
  let live = 1;
  const original = gate();
  const other = () => 'native other gate';
  const getter = () => original;
  const source = Object.create(prototype, {
    gates: { value: toggles, enumerable: true },
    native: { get: getter, enumerable: true },
    live: { get: () => live, enumerable: true },
    other: { value: other, enumerable: true },
    hidden: { value: 'hidden' },
    [symbol]: { value: 'symbol' },
  });
  Object.preventExtensions(source);
  const namespace = patch(both, source);
  assert.notEqual(namespace, source);
  assert.equal(Object.getPrototypeOf(namespace), prototype);
  assert.equal(Object.isFrozen(namespace), true);
  assert.deepEqual(Reflect.ownKeys(namespace), Reflect.ownKeys(source));
  for (const key of ['gates', 'live', 'other', 'hidden', symbol]) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(namespace, key), Object.getOwnPropertyDescriptor(source, key));
  }
  const nativeDescriptor = Object.getOwnPropertyDescriptor(namespace, 'native')!;
  assert.equal(nativeDescriptor.configurable, false);
  assert.equal(nativeDescriptor.enumerable, true);
  assert.equal(typeof nativeDescriptor.get, 'function');
  assert.equal(nativeDescriptor.set, undefined);
  assert.equal(namespace.native(), true);
  assert.equal(source.native(), false);
  assert.equal(namespace.other, other);
  assert.equal(namespace.other(), 'native other gate');
  live = 2;
  assert.equal(namespace.live, 2);
});

test('live gate bindings are revalidated and throwing getters retain their behavior', () => {
  let current: (...args: any[]) => any = gate();
  let broken = false;
  const source = {
    gates: toggles,
    get native() {
      if (broken) throw new Error('export not ready');
      return current;
    },
  };
  const namespace = patch(both, source);
  const wrapped = namespace.native;
  assert.equal(namespace.native, wrapped);
  assert.equal(wrapped(), true);
  const result = {};
  const receiver = {};
  current = new Function(
    'result',
    `return function shouldShareReduxStateDescriptors(...args) {
    if (this !== args[0]) throw new Error('receiver changed');
    return result;
  }`,
  )(result);
  assert.equal(namespace.native, current);
  assert.equal(namespace.native.call(receiver, receiver), result);
  current = new Proxy(gate(), {
    get(target, key, proxyReceiver) {
      if (key === 'name') throw new Error('opaque function');
      return Reflect.get(target, key, proxyReceiver);
    },
  });
  assert.equal(namespace.native, current);
  assert.equal(namespace.native(), false);
  current = gate();
  assert.equal(namespace.native(), true);
  broken = true;
  assert.throws(() => namespace.native, /export not ready/);
});

test('missing/changed enum identity and changed gate source retain native behavior', () => {
  const unchanged = [
    { native: gate() },
    { gates: { ReduxSharedStateDescriptors: 'some_other_toggle' }, native: gate() },
    { gates: Object.create(toggles), native: gate() },
    {
      gates: {
        get ReduxSharedStateDescriptors() {
          return toggles.ReduxSharedStateDescriptors;
        },
      },
      native: gate(),
    },
    {
      gates: toggles,
      native: new Function(
        'return function shouldShareReduxStateDescriptors() { /* flags.ReduxSharedStateDescriptors */ return false; }',
      )(),
    },
    {
      gates: toggles,
      native: new Function(
        'return function shouldShareReduxStateDescriptors() { return "flags.ReduxSharedStateDescriptors"; }',
      )(),
    },
    {
      gates: toggles,
      native: new Function(
        'readGate',
        'return function shouldShareReduxStateDescriptors() { return readGate({OtherGate:false}.OtherGate); }',
      )((value: unknown) => value),
    },
    {
      gates: toggles,
      native: new Function(
        'readGate',
        'toggles',
        'return function shouldShareReduxStateDescriptors() { return readGate(toggles.ReduxSharedStateDescriptors) || true; }',
      )(() => false, toggles),
    },
  ];
  const patcher = createNativeStateGatePatcher(both);
  for (const source of unchanged) assert.equal(patcher(source), undefined);
});

test('each gate requires its own matching enum member even when another gate matches', () => {
  const source = {
    gates: { ReduxSharedStateDescriptors: toggles.ReduxSharedStateDescriptors, HotPathStableShapes: 'changed' },
    shared: gate(),
    stable: gate('HotPathStableShapes'),
  };
  const namespace = patch(both, source);
  assert.equal(namespace.shared(), true);
  assert.equal(namespace.stable, source.stable);
  assert.equal(namespace.stable(), false);
});

test('an unrelated throwing export is preserved and recognized gate aliases share one wrapper', () => {
  const original = gate();
  const source = {
    get unrelated() {
      throw new Error('unrelated lazy export');
    },
    gates: toggles,
    first: original,
    get second() {
      return original;
    },
  };
  const namespace = patch(both, source);
  assert.equal(namespace.first, namespace.second);
  assert.equal(namespace.first(), true);
  assert.equal(namespace.second(), true);
  assert.throws(() => namespace.unrelated, /unrelated lazy export/);
});

test('cached recognition cannot carry enum eligibility between separately loaded module namespaces', () => {
  const patcher = createNativeStateGatePatcher(both);
  const shared = gate();
  const stable = gate('HotPathStableShapes');
  const first = patcher({ gates: toggles, shared, stable });
  assert.equal(first.shared(), true);
  assert.equal(first.stable(), true);

  // Re-exporting a recognized function still requires this namespace's enum.
  for (const gates of [undefined, {}, { ReduxSharedStateDescriptors: 'changed' }]) {
    assert.equal(patcher({ gates, shared, stable }), undefined);
  }
  const sharedOnly = patcher({
    gates: { ReduxSharedStateDescriptors: toggles.ReduxSharedStateDescriptors },
    shared,
    stable,
  });
  assert.equal(sharedOnly.shared(), true);
  assert.equal(sharedOnly.stable, stable);
  assert.equal(sharedOnly.stable(), false);

  // A separate factory instance gets its own wrappers without changing originals.
  const secondSource = { gates: toggles, shared: gate(), stable: gate('HotPathStableShapes') };
  const second = patcher(secondSource);
  assert.notEqual(second.shared, first.shared);
  assert.notEqual(second.stable, first.stable);
  assert.equal(second.shared(), true);
  assert.equal(second.stable(), true);
  assert.equal(secondSource.shared(), false);
  assert.equal(secondSource.stable(), false);
});
