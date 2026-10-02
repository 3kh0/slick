import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('./index.tsx', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { default: RestrictedChannelWarning } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

test('warning updates with policies and Post anyway restores only the current account', () => {
  let patch!: (state: any) => any;
  let state: any = {
    channels: { C123: { properties: { posting_restricted_to: { type: ['admin'] } } } },
    readOnlyChannels: { C123: { isReadOnly: false } },
    threadOnlyChannels: { C123: { isThreadOnly: false } },
  };
  let user = 'UADMIN';
  let refreshes = 0;
  const plugin = new RestrictedChannelWarning(
    {
      members: { getCurrentMemberId: () => user },
      redux: {
        patchState(callback: typeof patch) {
          patch = callback;
        },
        getRawState: () => state,
        refresh() {
          refreshes++;
        },
        mapEntries(slice: object, map: (id: string, entry: any) => any) {
          return new Proxy(slice, {
            get(target: any, id: string) {
              return map(id, target[id]);
            },
          });
        },
      },
      patchComponent() {},
    },
    {},
  );
  plugin.start();
  assert.equal(patch(state).threadOnlyChannels.C123.isThreadOnly, true);
  assert.equal(state.threadOnlyChannels.C123.isThreadOnly, false);
  plugin.ignore('C123');
  assert.equal(refreshes, 1);
  assert.equal(patch(state).threadOnlyChannels.C123.isThreadOnly, false);
  user = 'UOTHER';
  assert.equal(patch(state).threadOnlyChannels.C123.isThreadOnly, true);
  state = {
    ...state,
    channels: {
      C123: { properties: { posting_restricted_to: { type: ['admin'] }, threads_restricted_to: { type: ['admin'] } } },
    },
  };
  assert.equal(patch(state).readOnlyChannels.C123.isReadOnly, true);
  state = { ...state, channels: { C123: { properties: {} } } };
  assert.equal(patch(state).readOnlyChannels.C123.isReadOnly, false);
  assert.equal(patch(state).threadOnlyChannels.C123.isThreadOnly, false);
});
