import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createThunkPatches } from '../../app/slack/thunkPatches.ts';

const bundle = await build({
  entryPoints: [new URL('./index.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { default: HuddleMuteDetector } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

const mute = { alert: 'peerMuteRequest', peerId: 'attendee-123' };
const huddle = {
  peers: { byId: { 'attendee-123': { userId: 'UMUTER' }, 'attendee-other': { userId: 'UOTHER' } } },
  members: {
    UMUTER: { profile: { display_name: 'Display name', real_name: 'Real name' }, name: 'username' },
    UOTHER: { name: 'Other user' },
  },
};
type Toast = { content: string; huddleToastType: string };
type Creator = (payload: Toast) => unknown;

function fixture() {
  const patches = createThunkPatches();
  const abort = new AbortController();
  const disposers: (() => void)[] = [];
  const waits: string[] = [];
  const actions: unknown[] = [];
  let creator: () => Promise<Creator> = async () => (payload) => ({ type: 'huddle-toast', payload });
  const plugin = new HuddleMuteDetector(
    {
      signal: abort.signal,
      redux: {
        patchThunk(name: string, wrap: Parameters<typeof patches.patch>[1]) {
          disposers.push(patches.patch(name, wrap));
        },
        waitForThunkCreator(name: string) {
          waits.push(name);
          return creator();
        },
        getRawState() {
          throw new Error('must use the huddle store, not the main window');
        },
        dispatchThunk() {
          throw new Error('must dispatch to the huddle store, not the main window');
        },
      },
    },
    {},
  );
  plugin.start();
  const originals: { receiver: unknown; args: unknown[] }[] = [];
  const executions: { receiver: unknown; args: unknown[] }[] = [];
  const result = Promise.resolve('original alert');
  const thunk = Object.assign(
    function (this: unknown, ...args: unknown[]) {
      executions.push({ receiver: this, args });
      return result;
    },
    { isThunk: true, type: 'display-alert', payload: mute, description: 'Display alert message for huddle call' },
  );
  const original = Object.assign(
    function (this: unknown, ...args: unknown[]) {
      originals.push({ receiver: this, args });
      return thunk;
    },
    { meta: { name: 'displayAlertMessage' } },
  );
  const alert = patches.wrapCreator(original);
  const dispatch = (action: unknown) => {
    actions.push(action);
  };
  return {
    abort,
    actions,
    alert,
    dispatch,
    executions,
    originals,
    result,
    thunk,
    waits,
    creator: (next: typeof creator) => (creator = next),
    stop() {
      abort.abort();
      for (const dispose of disposers) dispose();
    },
  };
}

test('mute attribution uses the dispatched huddle store and preserves Slack thunk behavior and metadata', async () => {
  const f = fixture();
  const receiver = {};
  const args = [mute, 'creator extra'];
  const thunk = f.alert.apply(receiver, args);
  assert.deepEqual(f.originals, [{ receiver, args }]);
  assert.equal(thunk.isThunk, true);
  assert.equal(thunk.type, f.thunk.type);
  assert.equal(thunk.payload, mute);
  assert.equal(thunk.description, f.thunk.description);
  assert.deepEqual(f.waits, [], 'creating a thunk alone must not announce a mute');

  const context = () => 'context';
  const thunkArgs = [f.dispatch, () => huddle, context];
  assert.equal(thunk.apply(receiver, thunkArgs), f.result);
  assert.deepEqual(f.executions, [{ receiver, args: thunkArgs }]);
  await f.result;
  assert.deepEqual(f.waits, ['enqueueHuddleToast']);
  assert.deepEqual(f.actions, [
    { type: 'huddle-toast', payload: { content: 'Display name muted you.', huddleToastType: 'peer_mute_request' } },
  ]);
});

test('name resolution falls back to real name, username, and Slack user ID', async () => {
  for (const [member, name] of [
    [{ profile: { display_name: '', real_name: 'Real name' }, name: 'username' }, 'Real name'],
    [{ profile: {}, name: 'username' }, 'username'],
    [undefined, 'UMUTER'],
  ] as const) {
    const f = fixture();
    const state = { ...huddle, members: { UMUTER: member } };
    await f.alert(mute)(f.dispatch, () => state);
    assert.deepEqual(f.actions, [
      { type: 'huddle-toast', payload: { content: `${name} muted you.`, huddleToastType: 'peer_mute_request' } },
    ]);
  }
});

test('missing peers and forwarded main-window alerts do not guess or duplicate attribution', async () => {
  const f = fixture();
  for (const state of [
    undefined,
    {},
    { members: huddle.members },
    { peers: { byId: {} } },
    { peers: { byId: { 'attendee-other': { userId: 'UOTHER' } } } },
    { peers: { byId: { 'attendee-123': {} } } },
  ]) {
    await f.alert(mute)(f.dispatch, () => state);
  }
  assert.deepEqual(f.waits, []);
  await f.alert(mute)(f.dispatch, () => huddle);
  await f.alert(mute)(f.dispatch, () => ({ members: huddle.members }));
  assert.equal(f.actions.length, 1);
  assert.equal(f.executions.length, 8);
});

test('unrelated alerts and malformed mute requests retain the original thunk unchanged', () => {
  const f = fixture();
  for (const payload of [
    undefined,
    null,
    {},
    { alert: 'remotePeerMuted' },
    { alert: 'peerMuteRequest' },
    { ...mute, peerId: 123 },
  ]) {
    assert.equal(f.alert(payload), f.thunk);
  }
  assert.deepEqual(f.waits, []);
  assert.deepEqual(f.actions, []);
});

test('state, module discovery, and toast failures cannot interrupt the original alert', async () => {
  for (const failure of ['state', 'lookup', 'creator', 'dispatch', 'rejection']) {
    const f = fixture();
    const error = new Error(failure);
    const fail = () => {
      throw error;
    };
    if (failure === 'lookup')
      f.creator(async () => {
        throw error;
      });
    if (failure === 'creator') f.creator(async () => fail);
    const dispatch = failure === 'dispatch' ? fail : failure === 'rejection' ? () => Promise.reject(error) : f.dispatch;
    const getState = failure === 'state' ? fail : () => huddle;
    assert.equal(f.alert(mute)(dispatch, getState), f.result);
    await f.result;
    // Allow the rejected toast promise to reach the plugin's catch.
    await Promise.resolve();
    assert.equal(f.executions.length, 1);
  }
});

test('disabling removes the hook and suppresses already-created or waiting notifications', async () => {
  const f = fixture();
  let resolve!: (creator: Creator) => void;
  f.creator(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const createdBeforeStop = f.alert(mute);
  await f.alert(mute)(f.dispatch, () => huddle);
  assert.equal(f.waits.length, 1);
  f.stop();
  resolve((payload) => ({ type: 'huddle-toast', payload }));
  await Promise.resolve();
  assert.deepEqual(f.actions, []);
  assert.equal(f.alert(mute), f.thunk);
  await createdBeforeStop(f.dispatch, () => huddle);
  assert.equal(f.waits.length, 1);
  assert.equal(f.executions.length, 2);
});
