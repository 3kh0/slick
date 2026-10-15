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
const { default: ShowSendingBot } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

test('only sender avatars mount badge subscriptions, including after context changes', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  const contexts: any[] = [];
  Object.defineProperty(globalThis, 'React', {
    configurable: true,
    value: {
      Fragment: 'Fragment',
      createContext(value: unknown) {
        const context = { value, Provider: 'Provider' };
        contexts.push(context);
        return context;
      },
      createElement(type: unknown, props: object, ...children: unknown[]) {
        return {
          type,
          props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) },
        };
      },
      useContext: (context: any) => context.value,
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  });

  const patches = new Map<string, (props: any) => any>();
  const Original = 'SlackAvatar';
  const bot = { id: 'BTEST', name: 'Relay' };
  let subscriptions = 0;
  const plugin = new ShowSendingBot(
    {
      signal: new AbortController().signal,
      Cache: () => ({ peek: () => undefined }),
      setStyle() {},
      patchComponent(name: string, wrap: (original: any) => any) {
        if (typeof name === 'string') patches.set(name, wrap(Original));
      },
      redux: {
        useReduxState: (selector: () => unknown) => {
          subscriptions++;
          return selector();
        },
        usePatchVersion: () => subscriptions++,
      },
      members: {
        useMember: () => {
          subscriptions++;
          return undefined;
        },
      },
      messages: {
        asRawMessage: (msg: any) => msg && { ...msg, user: 'UBOT' },
        getMessageBotId: (msg: any) => msg?.bot_id,
        useMessageBot: () => {
          subscriptions++;
          return bot;
        },
      },
    },
    { hideMcpFooter: false },
  );
  plugin.start();
  const avatar = patches.get('ConnectedBaseAvatar')!;
  const props = { className: 'c-message_kit__avatar', userId: 'UPERSON', size: 36 };

  // Even a sender-class avatar is inert until it receives a message context.
  assert.deepEqual(avatar(props), { type: Original, props });
  assert.equal(subscriptions, 0);

  const message = { user: 'UBOT', bot_id: bot.id, channel: 'CTEST', ts: '1' };
  contexts[0].value = message;
  for (const className of [undefined, '', 'sidebar-avatar', 'c-message_kit__avatar_extra']) {
    const unrelated = { ...props, className };
    assert.deepEqual(avatar(unrelated), { type: Original, props: unrelated });
  }
  assert.equal(subscriptions, 0);

  for (const className of [
    'c-message_kit__avatar',
    'extra c-search_message__avatar',
    'c-message_attachment__author_icon extra',
  ]) {
    const sender = avatar({ ...props, className });
    assert.equal(typeof sender.type, 'function');
    assert.equal(sender.props.msg.user, 'UPERSON');
    assert.equal(sender.props.msg.bot_id, bot.id);
    assert.equal(sender.props.children.type, Original);
    const badged = sender.type(sender.props);
    assert.equal(badged.props.className, 'slick-sending-bot');
    assert.equal(badged.props.children[0], sender.props.children);
    assert.equal(badged.props.children[1].props.bot, bot);
  }
  assert.ok(subscriptions > 0, 'real sender badges still subscribe to member and message updates');
  const before = subscriptions;
  contexts[0].value = undefined;
  assert.deepEqual(avatar(props), { type: Original, props });
  assert.equal(subscriptions, before);
});

test('gutter and thread badges subscribe only in eligible layouts while preserving the original component', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  const contexts: any[] = [];
  const React = {
    Fragment: 'Fragment',
    createContext(value: unknown) {
      const context = { value, Provider: 'Provider' };
      contexts.push(context);
      return context;
    },
    createElement(type: unknown, props: object, ...children: unknown[]) {
      return {
        type,
        props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) },
      };
    },
    useContext: (context: any) => context.value,
    isValidElement: (value: any) => !!value && typeof value === 'object' && 'type' in value && 'props' in value,
  };
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  });

  const patches = new Map<string, (props: any) => any>();
  const Original = 'SlackOriginal';
  const bot = { id: 'BTEST', name: 'Relay', user_id: 'UBOT' };
  const state = { userPrefs: { messages_theme: 'light' }, members: { UAPP: { profile: { api_app_id: 'ATEST' } } } };
  let reads = 0;
  const plugin = new ShowSendingBot(
    {
      signal: new AbortController().signal,
      Cache: () => ({ peek: () => 'ATEST' }),
      setStyle() {},
      patchComponent(name: unknown, wrap: (original: any) => any) {
        patches.set(typeof name === 'string' ? name : 'Gutter', wrap(Original));
      },
      redux: {
        useReduxState: (selector: (state: any) => unknown) => {
          reads++;
          return selector(state);
        },
        usePatchVersion: () => reads++,
      },
      members: {
        useMember: (id: keyof typeof state.members) => {
          reads++;
          return state.members[id];
        },
      },
      messages: {
        asRawMessage: (msg: any) => msg && { ...msg, user: msg.bot_id ? 'UBOT' : msg.user },
        getMessageBotId: (msg: any) => msg?.bot_id,
        useMessageBot: (msg: any) => {
          reads++;
          return msg?.bot_id ? bot : undefined;
        },
      },
    },
    { hideMcpFooter: false },
  );
  plugin.start();

  const plain = { user: 'UPERSON', channel: 'CTEST', ts: '1' };
  const relayed = { ...plain, bot_id: bot.id };
  const app = {
    ...plain,
    blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text: '*Sent using* <@UAPP>' }] }],
  };
  const timestamp = React.createElement('time', { className: 'p-message_pane_message__compact_timestamp' });
  const gutter = patches.get('Gutter')!;
  const comfortable = { light: React.createElement('Avatar', {}), children: 'content' };
  const compact = { compact: timestamp, children: 'content' };

  // Ineligible layouts never mount the component that owns sender hooks.
  contexts[0].value = relayed;
  assert.deepEqual(gutter(comfortable), { type: Original, props: comfortable });
  contexts[0].value = undefined;
  assert.deepEqual(gutter(compact), { type: Original, props: compact });
  assert.equal(reads, 0);

  let badgeType: unknown;
  for (const slot of ['compact', 'light']) {
    for (const msg of [plain, relayed, app]) {
      contexts[0].value = msg;
      const node = gutter({ [slot]: timestamp, children: 'content' });
      assert.equal(node.type, Original);
      assert.equal(node.props.children, 'content');
      const [originalTimestamp, badge] = node.props[slot].props.children;
      assert.equal(originalTimestamp, timestamp);
      badgeType ??= badge.type;
      assert.equal(badge.type, badgeType, 'the subscribed child keeps its type across slot and message changes');
      const output = badge.type(badge.props);
      if (msg === plain) assert.equal(output, null);
      else {
        assert.equal(output.props.corner, 'gutter');
        assert.equal(msg === app ? output.props.memberId : output.props.bot, msg === app ? 'UAPP' : bot);
      }
    }
  }

  const thread = patches.get('MessageSender')!;
  const props = { unchanged: 'value' };
  let threadBadgeType: unknown;
  for (const msg of [undefined, plain, relayed, app, undefined]) {
    contexts[1].value = msg;
    for (const dense of [false, true, false]) {
      state.userPrefs.messages_theme = dense ? 'dense' : 'light';
      reads = 0;
      const node = thread(props);
      assert.equal(node.type, React.Fragment);
      const [original, badge] = node.props.children;
      assert.deepEqual(original, { type: Original, props });
      assert.equal(reads, 0, 'the surrounding thread component does not subscribe');
      if (!msg) {
        assert.equal(badge, undefined);
        continue;
      }
      threadBadgeType ??= badge.type;
      assert.equal(badge.type, threadBadgeType);
      const senderBadge = badge.type(badge.props);
      assert.equal(reads, 1, 'thread eligibility observes the density setting');
      if (!dense) assert.equal(senderBadge, null);
      else {
        assert.equal(senderBadge.type, badgeType);
        const output = senderBadge.type(senderBadge.props);
        assert.ok(reads > 1, 'eligible badges still observe member and message updates');
        if (msg === plain) assert.equal(output, null);
        else {
          assert.equal(output.props.corner, 'inline');
          assert.equal(msg === app ? output.props.memberId : output.props.bot, msg === app ? 'UAPP' : bot);
        }
      }
    }
  }
});
