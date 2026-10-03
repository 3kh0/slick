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
