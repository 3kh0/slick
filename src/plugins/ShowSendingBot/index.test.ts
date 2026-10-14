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
