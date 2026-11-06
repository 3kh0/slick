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
const { default: SlimMessageBox } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

test('toolbar toggle uses Slack broadcast state and leaves unavailable controls visible', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  const contexts: any[] = [];
  Object.defineProperty(globalThis, 'React', {
    configurable: true,
    value: {
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
      isValidElement(element: any) {
        return !!element?.props;
      },
      useMemo(factory: () => unknown) {
        return factory();
      },
      useContext(context: any) {
        return context.value;
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  });
  const patches = new Map<string, (props: any) => any>();
  const Original = 'SlackOriginal';
  const styles: string[] = [];
  const plugin = new SlimMessageBox(
    {
      elements: { Tooltip: 'Tooltip' },
      setStyle(css: string) {
        styles.push(css);
      },
      patchComponent(name: string, wrap: (original: any) => any) {
        patches.set(name, wrap(Original));
      },
    },
    { broadcastButton: true, discordLayout: false },
  );
  plugin.start();
  const input = patches.get('MessageInput')!;
  const toolbar = patches.get('TextyButtonOverflow')!;
  const changes: boolean[] = [];
  const controls = {
    type: 'SlackCheckbox',
    props: {
      broadcast: false,
      channelType: 'channel',
      onBroadcastChange(event: { target: { checked: boolean } }) {
        changes.push(event.target.checked);
      },
    },
  };
  const wrapped = input({ broadcastControls: controls, unrelated: 'preserved' });
  contexts[0].value = wrapped.props.value;
  assert.equal(wrapped.props.children.props.unrelated, 'preserved');
  assert.equal(wrapped.props.children.props.broadcastControls.props.children, controls);
  const result = toolbar({ children: 'native buttons' });
  assert.equal(result.props.children[0], 'native buttons');
  const button = result.props.children[1].props.children;
  assert.equal(button.props['aria-pressed'], false);
  assert.equal(button.props['aria-label'], 'Also send to channel');
  button.props.onClick();
  assert.deepEqual(changes, [true]);
  const active = input({
    broadcastControls: { ...controls, props: { ...controls.props, broadcast: true, channelType: 'im' } },
  });
  contexts[0].value = active.props.value;
  const activeButton = toolbar({}).props.children[1].props.children;
  assert.equal(activeButton.props['aria-pressed'], true);
  assert.equal(activeButton.props['aria-label'], 'Also send as direct message');
  activeButton.props.onClick();
  assert.deepEqual(changes, [true, false]);
  const unsupported = { type: 'SlackCheckbox', props: { broadcast: false } };
  const fallback = input({ broadcastControls: unsupported });
  assert.equal(fallback.props.children.props.broadcastControls, unsupported);
  contexts[0].value = fallback.props.value;
  assert.equal(toolbar({ children: 'native buttons' }).props.children, 'native buttons');
  assert.ok(styles.some((css) => css.includes('display: none')));
});

test('hide broadcast takes precedence and the new toggle is opt-in', () => {
  for (const config of [{ hideBroadcast: true, broadcastButton: true }, {}]) {
    const names: string[] = [];
    const plugin = new SlimMessageBox(
      {
        patchComponent(name: string) {
          names.push(name);
        },
        setStyle() {},
      },
      config,
    );
    plugin.start();
    assert.equal(names.includes('MessageInput'), false);
    assert.equal(names.includes('TextyButtonOverflow'), false);
    assert.equal(names.includes('InputContainer'), config.hideBroadcast === true);
  }
});

test('hiding emoji preserves the native GIF picker host and hides only its trigger', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  Object.defineProperty(globalThis, 'React', {
    configurable: true,
    value: {
      createElement: (type: unknown, props: unknown) => ({ type, props }),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  });
  let toolbar: (props: any) => any;
  const styles: string[] = [];
  const plugin = new SlimMessageBox(
    {
      setStyle: (css: string) => styles.push(css),
      patchComponent: (_name: string, wrap: (original: any) => any) => {
        toolbar = wrap('Original');
      },
    },
    { hideEmoji: true, hideMention: true, discordLayout: false },
  );
  plugin.start();
  const props = { enableEmojiButton: true, enableGifPicker: true, onGifSelected: () => {}, enableMentionButton: true };
  const result = toolbar!(props);
  assert.equal(result.props.enableEmojiButton, true);
  assert.equal(result.props.enableGifPicker, true);
  assert.equal(result.props.onGifSelected, props.onGifSelected);
  assert.equal(result.props.enableMentionButton, false);
  assert.equal(toolbar!({ enableEmojiButton: false }).props.enableEmojiButton, false);
  assert.ok(styles.some((css) => css.includes('emoji_toolbar_button') && css.includes('visibility: hidden')));
});
