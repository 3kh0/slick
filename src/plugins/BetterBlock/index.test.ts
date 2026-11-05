import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('./index.tsx', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { default: BetterBlock } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

function fixture(t: TestContext, storeInitiallyAvailable = true) {
  const previousReact = (globalThis as any).React;
  (globalThis as any).React = {
    createContext: () => ({}),
    createElement: (type: unknown, props: any, ...children: unknown[]) => ({
      type,
      props: { ...props, ...(children.length ? { children } : {}) },
    }),
    useMemo: (factory: () => unknown) => factory(),
    useLayoutEffect: (effect: () => void) => effects.push(effect),
    useEffect: (effect: () => void) => effects.push(effect),
  };
  const effects: (() => void)[] = [];
  const controller = new AbortController();
  const config = { blockedUsers: { UBLOCKED: 'Blocked' } as Record<string, string>, includeHiddenUsers: true };
  const state = { bootData: { user_id: 'USELF00' }, hiddenUsers: { UHIDDEN: true }, messages: {} };
  const slices = new Map<string, (key: string, entry: any) => any>();
  const statePatches: ((state: any) => any)[] = [];
  const thunks = new Map<string, (original: any) => any>();
  const components = new Map<string, (original: any) => any>();
  const dispatched: { name: string; args: any }[] = [];
  let subscriber: (() => void) | undefined;
  let refreshes = 0;
  let unsubscribed = false;
  let storeAvailable = storeInitiallyAvailable;
  const store = {
    getState: () => state,
    subscribe: (callback: () => void) => {
      subscriber = callback;
      return () => {
        unsubscribed = true;
      };
    },
  };
  const plugin = new BetterBlock(
    {
      signal: controller.signal,
      isActive: () => !controller.signal.aborted,
      rtm: { on: () => {} },
      redux: {
        getRawState: () => (storeAvailable ? state : undefined),
        getStore: () => (storeAvailable ? store : null),
        patchSlice: (name: string, transform: any) => slices.set(name, transform),
        patchState: (patch: (state: any) => any) => statePatches.push(patch),
        patchThunk: (name: string, transform: any) => thunks.set(name, transform),
        dispatchThunk: async (name: string, args: any) => dispatched.push({ name, args }),
        usePatchVersion: () => refreshes,
        useReduxState: (selector: (state: any) => unknown) => selector(state),
        refresh: () => {
          refreshes++;
          subscriber?.();
        },
      },
      patchComponent: (name: string, transform: any) => components.set(name, transform),
      members: {
        getCurrentMemberId: () => 'USELF00',
        getCachedMember: () => ({ profile: { display_name: 'Blocked' } }),
      },
      settings: {
        set: async (_key: string, value: any) => {
          config.blockedUsers = value;
          plugin.onSettingsChange();
          return true;
        },
      },
    },
    config,
  );
  t.after(() => {
    plugin.stop();
    (globalThis as any).React = previousReact;
  });
  plugin.start();
  return {
    plugin,
    config,
    state,
    slices,
    projectState: (raw: any) => statePatches.reduce((projected, patch) => patch(projected), raw),
    thunks,
    components,
    dispatched,
    flushEffects: () => effects.splice(0).forEach((effect) => effect()),
    controller,
    change: () => subscriber?.(),
    mountStore: () => {
      storeAvailable = true;
      plugin.watchStore();
    },
    unsubscribed: () => unsubscribed,
  };
}

test('native hidden list and live unblocking invalidate filters, never block self, and unsubscribe on abort', (t) => {
  const f = fixture(t);
  const row = f.components.get('MessageWrapper')!('Original');
  assert.equal(row({ msg: { user: 'UBLOCKED' } }), null);
  assert.equal(row({ msg: { user: 'UHIDDEN' } }), null);
  assert.equal(f.slices.has('typing'), false, 'value-only patches leave enumerable undefined entries');
  f.config.blockedUsers = { USELF00: 'Me' };
  f.plugin.onSettingsChange();
  assert.notEqual(row({ msg: { user: 'UBLOCKED' } }), null);
  assert.notEqual(row({ msg: { user: 'USELF00' } }), null);
  f.config.includeHiddenUsers = false;
  f.plugin.onSettingsChange();
  assert.notEqual(row({ msg: { user: 'UHIDDEN' } }), null);
  f.config.includeHiddenUsers = true;
  f.state.hiddenUsers = { UHIDDEN: false };
  f.change();
  assert.notEqual(row({ msg: { user: 'UHIDDEN' } }), null);
  assert.equal(f.slices.has('members'), false, 'huddle member identities must not be rewritten');
  f.controller.abort();
  assert.equal(f.unsubscribed(), true);
});

test('typing projection stays enumerable-safe across updates and restores on unblock', (t) => {
  const f = fixture(t);
  const typing = {
    blocked: { memberId: 'UBLOCKED', channelId: 'D1' },
    allowed: { memberId: 'UOTHER', channelId: 'C1' },
  };
  const raw = { typing };
  const projected = f.projectState(raw);
  assert.deepEqual(Object.keys(projected.typing), ['allowed']);
  assert.equal(
    Object.values<any>(projected.typing).some((typer) => typer.channelId === 'D1'),
    false,
  );
  assert.equal(f.projectState(raw).typing, projected.typing, 'stable slice identity between events');
  assert.equal(
    f.projectState({ typing: { ...typing, allowed: { memberId: 'UOTHER', channelId: 'D2' } } }).typing.allowed
      .channelId,
    'D2',
  );
  f.config.blockedUsers = {};
  f.plugin.onSettingsChange();
  assert.equal(f.projectState(raw).typing, typing);
});

test('thread rows retain their navigation, use a visible preview, and recover stale props on unblock', (t) => {
  const f = fixture(t);
  const blockedMessage = { channel: 'C1', ts: '3', thread_ts: '1', user: 'UBLOCKED' };
  (f.state.messages as any).C1 = {
    '1': { ts: '1', user: 'UROOT' },
    '2': { ts: '2', thread_ts: '1', user: 'UOTHER' },
    '3': blockedMessage,
  };
  const item = {
    type: 'thread_v2',
    channelId: 'C1',
    key: 'thread-C1-1',
    threadTs: '1',
    ts: '3',
    feedTs: '3',
    messageTs: '3',
    latestTs: '3',
    minUnreadTs: '2',
    unreadCount: 2,
  };
  for (const name of [
    'ActivityItem',
    'ActivityThread',
    'ActivityRowContentSingleLine',
    'ActivityRowContentMultiLine',
    'ActivityRowContentDense',
    'ActivityRowContentDetailed',
  ]) {
    const row = f.components.get(name)!('Original');
    const rendered = row({ activityItem: item, msg: blockedMessage });
    assert.notEqual(rendered, null, name);
    assert.equal(rendered.props.msg.user, 'UOTHER');
    assert.equal(rendered.props.activityItem.feedTs, '2');
    assert.equal(rendered.props.activityItem.key, item.key);
    assert.equal(row(rendered.props).props.activityItem.unreadCount, 1, 'nested projections must not subtract twice');
  }
  const row = f.components.get('ActivityRowContentSingleLine')!('Original');
  const stale = row({ activityItem: item }).props;
  f.config.blockedUsers = {};
  f.plugin.onSettingsChange();
  assert.equal(row(stale).props.activityItem, item);
});

test('starting before Slack mounts its store attaches the block-list and auto-read observers later', (t) => {
  const f = fixture(t, false);
  const row = f.components.get('MessageWrapper')!('Original');
  assert.notEqual(row({ msg: { user: 'UHIDDEN' } }), null);
  assert.equal(f.plugin.unsubscribe, undefined);
  f.mountStore();
  assert.equal(typeof f.plugin.unsubscribe, 'function');
  assert.equal(row({ msg: { user: 'UHIDDEN' } }), null);
  assert.equal(f.plugin.dmReader.channels, (f.state as any).channels);
  f.controller.abort();
  assert.equal(f.plugin.storePoll, undefined);
  assert.equal(f.unsubscribed(), true);
});

test('blocked DMs are hidden from both Activity and DM lists', (t) => {
  const f = fixture(t);
  (f.state as any).channels = { D1: { is_im: true, user: 'UBLOCKED' } };
  assert.equal(f.components.get('DmsChannel')!('Original')({ channelId: 'D1' }), null);
  assert.equal(
    f.components.get('ActivityItem')!('Original')({ isDmTab: true, msg: { channel: 'D1', user: 'USELF00' } }),
    null,
  );
  for (const name of ['ActivityRowContentSingleLine', 'ActivityRowContentMultiLine']) {
    assert.equal(f.components.get(name)!('Original')({ activityItem: { type: 'dm', channelId: 'D1' } }), null);
  }
});

test('search thunk filtering preserves receivers, metadata and synchronous or deferred results', async (t) => {
  const f = fixture(t),
    receiver = {},
    results = [{ id: 'UBLOCKED' }, { id: 'UOTHER' }];
  for (const deferred of [false, true]) {
    const original = function (this: unknown) {
      assert.equal(this, receiver);
      return Object.assign(
        function (this: unknown) {
          assert.equal(this, receiver);
          return deferred ? Promise.resolve(results) : results;
        },
        { meta: 'search' },
      );
    };
    const thunk = f.thunks.get('autocompleteMembers')!(original).call(receiver);
    assert.equal(thunk.meta, 'search');
    const result = thunk.call(receiver);
    assert.equal(result instanceof Promise, deferred);
    assert.deepEqual(await result, [{ id: 'UOTHER' }]);
  }
});

test('notification veto happens before native notification or audio work; calls and allowed users pass through intact', async (t) => {
  const f = fixture(t);
  let calls = 0;
  const receiver = {};
  const original = function (this: unknown, ...args: unknown[]) {
    assert.equal(this, receiver);
    calls++;
    return args;
  };
  const show = f.thunks.get('showNotification')!(original);
  const suppressed = show.call(receiver, { message: { user: 'UBLOCKED' } });
  assert.equal(calls, 0);
  await suppressed();
  assert.equal(calls, 0);
  const allowed = { message: { user: 'UOTHER' } };
  assert.deepEqual(show.call(receiver, allowed), [allowed]);
  const call = { message: { user: 'UBLOCKED' }, options: { is_call_notification: true } };
  assert.deepEqual(show.call(receiver, call), [call]);
  const huddle = { message: { user: 'UBLOCKED', subtype: 'huddle_thread' } };
  assert.deepEqual(show.call(receiver, huddle), [huddle]);
  assert.equal(f.thunks.has('showHuddleNotification'), false);
});

test('search hides a blocked primary hit instead of substituting a context message', (t) => {
  const f = fixture(t);
  const row = f.components.get('MessageListItem')!('Original');
  assert.equal(row({ result: { messages: [{ user: 'UBLOCKED' }, { user: 'UOTHER' }] } }), null);
  const result = row({ result: { iid: 'hit', messages: [{ user: 'UOTHER' }, { user: 'UBLOCKED' }] } });
  assert.equal(result.props.result.iid, 'hit');
  assert.equal(result.props.result.messages.length, 1);
});

test('context-menu action persists local block and unblock without calling Slack', async (t) => {
  const f = fixture(t);
  const original = () => () => Promise.resolve([{ key: 'existing', label: 'Existing' }]);
  const getMenu = f.thunks.get('getMemberContextMenuTemplate')!(original);
  const template = await getMenu({ id: 'UBLOCKED' })();
  assert.equal(template.at(-1).label, 'Unblock Blocked');
  assert.equal(template.at(-1).danger, false);
  template.at(-1).click();
  await Promise.resolve();
  assert.equal(f.config.blockedUsers.UBLOCKED, undefined);
  const unblocked = await getMenu({ id: 'UBLOCKED' })();
  assert.equal(unblocked.at(-1).label, 'Block Blocked');
  assert.equal(unblocked.at(-1).danger, true);
  const self = await getMenu({ id: 'USELF00' })();
  assert.equal(self.length, 1);
  f.controller.abort();
  const afterStop = await getMenu({ id: 'UBLOCKED' })();
  assert.equal(afterStop.length, 1);
});

test('global autocomplete and input realign upstream selection before accepting a visible result', (t) => {
  const f = fixture(t);
  const suggestions = [{ id: 'UBLOCKED' }, { id: 'query' }, { id: 'UOTHER' }];
  const menu = f.components.get('SearchAutocomplete')!('Original');
  const input = f.components.get('SearchInputBox')!('Original');
  let selection: number | null = null;
  let accepted = 0;
  const props = {
    suggestions,
    selectedIndex: selection,
    onSuggestionSelected: (next: any) => {
      selection = next.selectedIndex;
    },
    onAccept: () => accepted++,
  };
  const rendered = menu(props);
  assert.equal(rendered.props.suggestions[0].id, 'query');
  rendered.props.onAccept();
  const pendingInput = input({ suggestions, autocompleteSelectedIndex: null, onEnter: () => accepted++ });
  pendingInput.props.onEnter();
  assert.equal(accepted, 0);
  f.flushEffects();
  assert.equal(selection, 1);
  const ready = menu({ ...props, selectedIndex: selection });
  ready.props.onSuggestionSelected({ selectedIndex: 1, setText: true });
  assert.equal(selection, 2);
  const readyInput = input({ suggestions, autocompleteSelectedIndex: selection, onEnter: () => accepted++ });
  assert.equal(readyInput.props.autocompleteSelectedIndex, 1);
  readyInput.props.onEnter();
  assert.equal(accepted, 1);
});

test('blocked profile popups blur an inert, screen-reader-hidden background and restore on unblock', (t) => {
  const f = fixture(t);
  const popup = f.components.get('MemberProfileHoverCard')!('Original');
  const rendered = popup({ memberId: 'UBLOCKED' });
  const [background, overlay] = rendered.props.children;
  assert.equal(background.props.inert, true);
  assert.equal(background.props['aria-hidden'], 'true');
  assert.equal(background.props.style.filter, 'blur(8px)');
  assert.equal(overlay.props.children[0], 'You blocked this person');
  assert.equal(popup({ memberId: 'UOTHER' }).type, 'Original');
  f.config.blockedUsers = {};
  f.plugin.onSettingsChange();
  assert.equal(popup({ memberId: 'UBLOCKED' }).type, 'Original');
});

test('unblocking restores content when Slack connect retains previously filtered props', (t) => {
  const f = fixture(t);
  f.config.blockedUsers = {};
  f.plugin.onSettingsChange();
  const message = {
    channel: 'C1',
    ts: '1',
    user: 'UOTHER',
    text: '<@UBLOCKED>',
    attachments: [{ author_id: 'UBLOCKED', text: 'forward' }],
  };
  (f.state.messages as any).C1 = { '1': message };
  const stale = { ...message, text: '', attachments: [] };
  const row = f.components.get('MessageWrapper')!('Original')({ msg: stale });
  assert.equal(row.props.msg, message);
  (f.state as any).reactions = { reaction: [{ count: 1, users: ['UBLOCKED'] }] };
  const bar = f.components.get('ReactionBar')!('Original')({ reactionKey: 'reaction', reactions: [] });
  assert.equal(bar.props.reactions.length, 1);
  assert.deepEqual(bar.props.reactions[0].users, ['UBLOCKED']);
});

test('thread bars with blocked repliers load the thread once so blocked replies leave the count', (t) => {
  const f = fixture(t);
  const root = { channel: 'C1', ts: '1', reply_count: 2, reply_users: ['UBLOCKED', 'UOTHER'], latest_reply: '3' };
  (f.state.messages as any).C1 = { '1': root };
  const render = () => {
    f.components.get('ThreadReplies')!('Original')({ msg: root, channelId: 'C1' });
    f.flushEffects();
  };
  render();
  render();
  assert.deepEqual(f.dispatched, [
    {
      name: 'requestReplies',
      args: { channelId: 'C1', threadTs: '1', limit: 3, reason: 'betterblock', skipSubscriptionUpdate: true },
    },
  ]);
  (f.state.messages as any).C1 = {
    '1': { ...root, reply_count: 3, latest_reply: '4' },
    '2': { ts: '2', thread_ts: '1', user: 'UBLOCKED' },
    '3': { ts: '3', thread_ts: '1', user: 'UOTHER' },
    '4': { ts: '4', thread_ts: '1', user: 'UOTHER' },
  };
  render();
  (f.state.messages as any).C1 = { '5': { ...root, ts: '5', reply_users: ['UOTHER'] } };
  f.components.get('ThreadReplies')!('Original')({ msg: { ...root, ts: '5' }, channelId: 'C1' });
  f.flushEffects();
  assert.equal(f.dispatched.length, 1);
});
