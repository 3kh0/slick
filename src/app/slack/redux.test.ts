import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('./redux.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { mapEntries } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

const hiddenSlice = (entries: Record<string, unknown>) =>
  Object.create(Object.create(Object.prototype, Object.getOwnPropertyDescriptors(entries)));

test('mapEntries maps entries Slack keeps on the slice prototype', () => {
  const slice = hiddenSlice({ U1: { name: 'a' }, U2: { name: 'b' } });
  const proxy = mapEntries(slice, (key: string, entry: any) =>
    key === 'U1' ? { ...entry, name: 'nick' } : entry,
  ) as any;
  assert.equal(proxy.U1.name, 'nick');
  assert.equal(proxy.U2, slice.U2);
  assert.equal(proxy.U3, undefined);
});

test('mapEntries runs each entry once per raw value', () => {
  const slice = hiddenSlice({ U1: { name: 'a' } });
  let calls = 0;
  const proxy = mapEntries(slice, (_key: string, entry: any) => {
    calls++;
    return entry && { ...entry };
  }) as any;
  assert.equal(proxy.U1, proxy.U1);
  assert.equal(calls, 1);
});

test('mapEntries leaves locked own properties alone instead of breaking proxy invariants', () => {
  const slice = Object.freeze({ U1: { name: 'a' } });
  const proxy = mapEntries(slice, (_key: string, entry: any) => entry && { ...entry, name: 'nick' }) as any;
  assert.equal(proxy.U1, slice.U1);
  assert.equal('U1' in proxy, true);
});

test('mapEntries `in` follows the mapped value on ordinary slices', () => {
  const slice = hiddenSlice({ U1: { name: 'a' }, U2: { name: 'b' } });
  const proxy = mapEntries(slice, (key: string, entry: any) => (key === 'U2' ? undefined : entry)) as any;
  assert.equal('U1' in proxy, true);
  assert.equal('U2' in proxy, false);
  assert.equal('U3' in proxy, false);
});

test('object memo preserves identity across slice replacements and distinguishes aliased keys', () => {
  const raw = { name: 'raw' };
  let calls = 0;
  const transform = (key: string, entry: any) => {
    calls++;
    return entry && { ...entry, key };
  };
  const first = mapEntries(hiddenSlice({ U1: raw, U2: raw }), transform) as any;
  const u1 = first.U1;
  const u2 = first.U2;
  assert.notEqual(u1, u2);
  assert.equal(u1.key, 'U1');
  assert.equal(u2.key, 'U2');
  const second = mapEntries(hiddenSlice({ U1: raw, U2: raw }), transform) as any;
  assert.equal(second.U1, u1);
  assert.equal(second.U2, u2);
  assert.equal(calls, 2);
});

test('reentrant reads of object and function aliases preserve both transformed identities', () => {
  for (const raw of [{ name: 'raw' }, function rawEntry() {}]) {
    const calls: string[] = [];
    let proxy: any;
    proxy = mapEntries(hiddenSlice({ U1: raw, U2: raw }), (key: string, entry: any) => {
      calls.push(key);
      return { key, entry, nested: key === 'U1' ? proxy.U2 : undefined };
    });
    const u1 = proxy.U1;
    const u2 = u1.nested;
    assert.notEqual(u1, u2);
    assert.equal(u1.key, 'U1');
    assert.equal(u2.key, 'U2');
    assert.equal(proxy.U1, u1);
    assert.equal(proxy.U2, u2);
    assert.deepEqual(calls, ['U1', 'U2']);
  }
});

test('the outer completion replaces a nested cached result for the same key', () => {
  let calls = 0;
  let nested: any;
  let proxy: any;
  proxy = mapEntries(hiddenSlice({ U1: {} }), (key: string, entry: any) => {
    const call = ++calls;
    if (call === 1) nested = proxy.U1;
    return { key, entry, call };
  });
  const outer = proxy.U1;
  assert.equal(outer.call, 1);
  assert.equal(nested.call, 2);
  assert.notEqual(outer, nested);
  assert.equal(proxy.U1, outer);
  assert.equal(calls, 2);
});

test('undefined object transformations are cached and virtual entries retain identity', () => {
  const raw = {};
  let calls = 0;
  const transform = (_key: string, entry: any) => {
    calls++;
    return entry ? undefined : { virtual: true };
  };
  const proxy = mapEntries(hiddenSlice({ U1: raw }), transform) as any;
  assert.equal(proxy.U1, undefined);
  assert.equal(proxy.U1, undefined);
  assert.equal(proxy.U2, proxy.U2);
  assert.equal(calls, 2);
});

test('primitive changes and transitions between object and primitive inputs invalidate results', () => {
  const raw: any = { U1: 1 };
  const proxy = mapEntries(raw, (_key: string, entry: any) => ({ value: entry })) as any;
  const one = proxy.U1;
  assert.equal(proxy.U1, one);
  raw.U1 = { name: 'user' };
  const object = proxy.U1;
  assert.equal(object.value, raw.U1);
  assert.equal(proxy.U1, object);
  raw.U1 = 2;
  assert.equal(proxy.U1.value, 2);
  assert.notEqual(proxy.U1, one);
});
