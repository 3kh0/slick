import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('./index.tsx', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { default: BetterGifs, isGifPicker } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

// These fixtures deliberately retain Slack's double-quoted source marker through formatting.
const pickerSource = `function (props) {
  return { host: "gif-picker-host", selected: props.onGifSelected, query: props.emojiSearchQuery };
}`;
const anonymousPicker = new Function(`return (${pickerSource});`)();
const tenorResult = {
  id: '900719925474099312345',
  title: 'Happy cat',
  gif: 'https://media.tenor.com/cat.gif',
  preview: 'https://media1.tenor.com/cat-preview.gif',
  width: 320,
  height: 240,
};
const tenorGif = {
  provider: 'tenor',
  id: tenorResult.id,
  name: tenorResult.title,
  url: tenorResult.gif,
  previewUrl: tenorResult.preview,
  width: 320,
  height: 240,
};
const nativeProps = {
  id: 'giphy123',
  name: 'Waving dog',
  url: 'https://media.giphy.com/media/giphy123/giphy.gif',
  previewUrl: 'https://i.giphy.com/media/giphy123/200.gif',
  width: 200,
  height: 150,
  bytes: 12345,
  previewBytes: 1234,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flush() {
  // Drain the bridge/search/favorites promise chains without real sleeps.
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

type Element = { type: any; props: any };
type Frame = { type: any; slots: any[]; cursor: number };

/** A manual renderer: createElement never eagerly calls children, and effects clean up on unmount. */
function hookRenderer(t: TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  const frames = new Map<string, Frame>();
  const fragment = Symbol('Fragment');
  let active: Frame | undefined;
  let jobs: (() => void)[] = [];
  function slot() {
    assert.ok(active, 'Hooks must run inside a component');
    return { frame: active, index: active.cursor++ };
  }
  function disposeFrame(frame: Frame) {
    for (const value of frame.slots) value?.cleanup?.();
  }
  const react = {
    Fragment: fragment,
    createElement(type: any, props: any, ...children: any[]): Element {
      return {
        type,
        props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) },
      };
    },
    useState(initial: any) {
      const { frame, index } = slot();
      if (!(index in frame.slots)) frame.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      const state = frame.slots[index];
      return [
        state.value,
        (next: any) => {
          state.value = typeof next === 'function' ? next(state.value) : next;
        },
      ];
    },
    useRef(initial: any) {
      const { frame, index } = slot();
      if (!(index in frame.slots)) frame.slots[index] = { current: initial };
      return frame.slots[index];
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const { frame, index } = slot();
      const old = frame.slots[index];
      if (old && deps.length === old.deps.length && deps.every((dep, offset) => Object.is(dep, old.deps[offset])))
        return;
      const state = { deps, cleanup: undefined as void | (() => void) };
      frame.slots[index] = state;
      jobs.push(() => {
        old?.cleanup?.();
        state.cleanup = effect();
      });
    },
  };
  Object.defineProperty(globalThis, 'React', { configurable: true, value: react });
  function render(element: any): any {
    jobs = [];
    const seen = new Set<string>();
    function visit(value: any, path: string): any {
      if (Array.isArray(value))
        return value.map((child, index) => visit(child, `${path}/${child?.props?.key ?? index}`));
      if (!value || typeof value !== 'object' || !('type' in value)) return value;
      if (typeof value.type === 'function') {
        seen.add(path);
        let frame = frames.get(path);
        if (!frame || frame.type !== value.type) {
          if (frame) disposeFrame(frame);
          frame = { type: value.type, slots: [], cursor: 0 };
          frames.set(path, frame);
        }
        frame.cursor = 0;
        active = frame;
        let output;
        try {
          output = value.type(value.props);
        } finally {
          active = undefined;
        }
        return visit(output, `${path}/output`);
      }
      return { ...value, props: { ...value.props, children: visit(value.props.children, `${path}/children`) } };
    }
    const tree = visit(element, 'root');
    for (const [path, frame] of frames) {
      if (!seen.has(path)) {
        disposeFrame(frame);
        frames.delete(path);
      }
    }
    for (const job of jobs) job();
    return tree;
  }
  t.after(() => {
    for (const frame of frames.values()) disposeFrame(frame);
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  });
  return { render };
}

function nodes(tree: any): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object' || !('type' in tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}

function find(tree: any, predicate: (node: Element) => boolean): Element {
  const found = nodes(tree).find(predicate);
  assert.ok(found, 'Expected rendered control');
  return found;
}

const starButton = (tree: any) =>
  find(
    tree,
    (node) =>
      node.type === 'button' &&
      node.props['aria-pressed'] !== undefined &&
      /favorite/i.test(node.props['aria-label'] ?? ''),
  );
const providerSelect = (tree: any) => find(tree, (node) => node.type === 'select');

function fixture(
  t: TestContext,
  initial: unknown = { version: 1, gifs: [] },
  preferences = { provider: 'tenor', defaultView: 'search' },
) {
  const renderer = hookRenderer(t);
  const controller = new AbortController();
  const patches: { matcher: any; replace: (original: any) => (props: any) => Element }[] = [];
  const writes: { key: string; value: unknown }[] = [];
  const fetches: string[] = [];
  const settingWrites: [string, string][] = [];
  let saved = initial;
  let write: (value: unknown) => Promise<boolean> = async () => true;
  let fetch: (url: string) => Promise<{ status: number; body: string }> = async () =>
    assert.fail('Unexpected bridge fetch');
  class Store<T> {
    value: T;
    constructor(value: T) {
      this.value = value;
    }
    set(value: T) {
      this.value = value;
    }
    use() {
      return this.value;
    }
  }
  const config = { ...preferences };
  const plugin = new BetterGifs(
    {
      Store,
      signal: controller.signal,
      storage: {
        async get<T>(key: string, _fallback: T): Promise<T> {
          assert.equal(key, 'favorites');
          return saved as T;
        },
        async set(key: string, value: unknown) {
          writes.push({ key, value });
          const success = await write(value);
          if (success) saved = value;
          return success;
        },
      },
      fetch(url: string) {
        fetches.push(url);
        return fetch(url);
      },
      elements: { SvgIcon: 'slack-svg-icon' },
      setStyle() {},
      patchComponent(matcher: any, replace: (original: any) => (props: any) => Element) {
        patches.push({ matcher, replace });
      },
      settings: {
        set(key: string, value: string) {
          settingWrites.push([key, value]);
          assert.ok(key === 'provider' || key === 'defaultView');
          config[key] = value;
          plugin.onSettingsChange([key]);
        },
      },
      sendMessage() {
        assert.fail('Selecting or favoriting a GIF must not send a message');
      },
      messages: {
        send() {
          assert.fail('Selecting or favoriting a GIF must not send a message');
        },
      },
    },
    config,
  );
  plugin.start();
  t.after(() => {
    controller.abort();
    plugin.stop();
  });
  return {
    plugin,
    config,
    patches,
    writes,
    fetches,
    settingWrites,
    controller,
    render: renderer.render,
    fetchWith(implementation: typeof fetch) {
      fetch = implementation;
    },
    writeWith(implementation: typeof write) {
      write = implementation;
    },
    picker(original: any, props: any = {}) {
      const patch = patches.find((entry) => typeof entry.matcher === 'object');
      assert.ok(patch);
      return patch.replace(original)(props);
    },
    native(original: any, props: any) {
      const patch = patches.find((entry) => entry.matcher === 'GifListItem');
      assert.ok(patch);
      return patch.replace(original)(props);
    },
  };
}

function clickEvent() {
  let stops = 0;
  const event = {
    stopPropagation() {
      stops++;
    },
  };
  return { event, stopped: () => stops };
}

const callbacks = () => ({ onClosed() {}, onGifSelected() {} });
const response = (results: unknown[] = [tenorResult]) => ({ status: 200, body: JSON.stringify({ results }) });

test('isGifPicker matches anonymous stable implementation source, not hosts or exported wrappers', () => {
  assert.equal(anonymousPicker.name, '');
  assert.equal(isGifPicker(anonymousPicker), true);
  for (const candidate of [
    null,
    'gif-picker-host',
    { default: anonymousPicker },
    { render: anonymousPicker },
    new Function('return "gif-picker-host";'),
    new Function('props', 'return props.onGifSelected || props.emojiSearchQuery;'),
    (props: any) => anonymousPicker(props),
  ])
    assert.equal(isGifPicker(candidate), false);
});

test('isGifPicker rejects a module factory that contains an inline picker implementation', () => {
  const moduleFactory = new Function('module', 'exports', 'require', `exports.default = (${pickerSource});`);
  assert.equal(isGifPicker(moduleFactory), false, 'A module wrapper is not a renderable picker component');
});

test('start registers the source-filter matcher and native GifListItem patch', async (t) => {
  const f = fixture(t);
  await f.plugin.favorites.load();
  assert.equal(f.patches.length, 2);
  const sourcePatch = f.patches.find((entry) => typeof entry.matcher === 'object')!;
  assert.equal(sourcePatch.matcher.filter, isGifPicker);
  assert.equal(sourcePatch.matcher.filter(anonymousPicker), true);
  assert.equal(sourcePatch.matcher.filter('div'), false);
  assert.ok(f.patches.some((entry) => entry.matcher === 'GifListItem'));
  assert.deepEqual(f.fetches, []);
});

test('Tenor replacement renders its own picker without mounting Original or fetching Giphy', (t) => {
  const f = fixture(t);
  let originals = 0;
  const Original = () => {
    originals++;
    return { type: 'native-picker', props: {} };
  };
  const tree = f.render(f.picker(Original, callbacks()));
  assert.equal(originals, 0);
  assert.equal(providerSelect(tree).props.value, 'tenor');
  assert.ok(nodes(tree).some((node) => node.type === 'input' && node.props.type === 'search'));
  assert.deepEqual(f.fetches, []);
});

test('missing selection or close callbacks gracefully render Original with unchanged props', (t) => {
  const f = fixture(t);
  for (const props of [{}, { onClosed() {} }, { onGifSelected() {} }, { onClosed: 42, onGifSelected() {} }]) {
    let received: any;
    const Original = (value: any) => {
      received = value;
      return { type: 'native-picker', props: {} };
    };
    const tree = f.render(f.picker(Original, props));
    assert.equal(tree.type, 'native-picker');
    assert.deepEqual(received, props);
    assert.deepEqual(f.fetches, []);
  }
});

test('Tenor selection uses validated search results, closes before updating the draft, and never sends', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const f = fixture(t);
  f.fetchWith(async () => response([tenorResult, { ...tenorResult, id: '2', gif: 'https://evil.test/cat.gif' }]));
  const calls: any[] = [];
  let originals = 0;
  const click = clickEvent();
  const element = f.picker(
    () => {
      originals++;
      return null;
    },
    {
      emojiSearchQuery: 'cat',
      onClosed(event: unknown) {
        calls.push(['close', event]);
      },
      onGifSelected(event: unknown, payload: unknown) {
        calls.push(['select', event, payload]);
      },
    },
  );
  f.render(element);
  t.mock.timers.tick(349);
  assert.equal(f.fetches.length, 0);
  t.mock.timers.tick(1);
  await flush();
  const tree = f.render(element);
  const selections = nodes(tree).filter((node) => node.props['data-bg-select'] === 'true');
  assert.equal(selections.length, 1);
  selections[0].props.onClick(click.event);
  assert.deepEqual(calls, [
    ['close', click.event],
    [
      'select',
      click.event,
      { originalGifUrl: tenorResult.gif, previewUrl: tenorResult.preview, name: 'Happy cat', width: 320, height: 240 },
    ],
  ]);
  assert.equal(click.stopped(), 1);
  assert.equal(originals, 0);
  assert.equal(f.fetches.length, 1);
  assert.deepEqual(f.writes, []);
});

test('native Giphy favorite button is a sibling, never nested in the original result button', (t) => {
  const f = fixture(t);
  let received: any;
  const Original = (props: any) => {
    received = props;
    return {
      type: 'button',
      props: { 'data-native-result': true, children: { type: 'img', props: { src: props.previewUrl } } },
    };
  };
  const tree = f.render(f.native(Original, nativeProps));
  const native = find(tree, (node) => !!node.props['data-native-result']);
  const star = starButton(tree);
  assert.equal(tree.type, 'div');
  assert.equal(tree.props.children[0], native);
  assert.ok(nodes(tree.props.children[1]).includes(star));
  assert.equal(nodes(native).includes(star), false);
  assert.equal(nodes(tree).filter((node) => node.type === 'button').length, 2);
  assert.deepEqual(received, nativeProps);
});

test('favorite buttons reuse Slack’s outline and filled star icons', async (t) => {
  const f = fixture(t);
  const element = f.native(() => null, nativeProps);
  let tree = f.render(element);
  const icon = () => find(tree, (node) => node.type === 'slack-svg-icon');
  assert.equal(icon().props.name, 'star');
  assert.equal(icon().props.size, 16);
  await starButton(tree).props.onClick(clickEvent().event);
  tree = f.render(element);
  assert.equal(icon().props.name, 'star-filled');
});

test('invalid native Giphy props fall back to Original without a favorite wrapper', (t) => {
  const f = fixture(t);
  for (const props of [
    { ...nativeProps, url: 'https://evil.test/cat.gif' },
    { ...nativeProps, width: null },
    { ...nativeProps, bytes: -1 },
  ]) {
    let received: any;
    const tree = f.render(
      f.native((value: any) => {
        received = value;
        return { type: 'button', props: { children: 'native' } };
      }, props),
    );
    assert.equal(tree.type, 'button');
    assert.deepEqual(received, props);
    assert.equal(nodes(tree).length, 1);
  }
});

test('stars stop propagation and failed writes leave favorites unchanged while showing the error', async (t) => {
  const f = fixture(t);
  await f.plugin.favorites.load();
  const element = f.native(() => ({ type: 'button', props: {} }), nativeProps);
  for (const failure of ['false', 'throw']) {
    f.writeWith(async () => {
      if (failure === 'throw') throw new Error('Disk unavailable');
      return false;
    });
    const click = clickEvent();
    await starButton(f.render(element)).props.onClick(click.event);
    const star = starButton(f.render(element));
    assert.equal(click.stopped(), 1);
    assert.equal(star.props['aria-pressed'], false);
    assert.equal(star.props.disabled, false);
    assert.match(star.props.title, failure === 'throw' ? /Disk unavailable/ : /Could not save/);
    assert.deepEqual(f.plugin.favorites.current(), []);
    assert.deepEqual(f.plugin.gifs.use(), []);
  }
  assert.equal(f.writes.length, 2);
});

test('successful stars expose pending state and only change favorites after persistence', async (t) => {
  const f = fixture(t);
  await f.plugin.favorites.load();
  const written = deferred<boolean>();
  const started = deferred<void>();
  f.writeWith(async () => {
    started.resolve();
    return written.promise;
  });
  const element = f.native(() => ({ type: 'button', props: {} }), nativeProps);
  const click = clickEvent();
  const saving = starButton(f.render(element)).props.onClick(click.event);
  await started.promise;
  assert.equal(starButton(f.render(element)).props.disabled, true);
  assert.deepEqual(f.plugin.gifs.use(), []);
  written.resolve(true);
  await saving;
  const star = starButton(f.render(element));
  assert.equal(click.stopped(), 1);
  assert.equal(star.props.disabled, false);
  assert.equal(star.props['aria-pressed'], true);
  assert.equal(f.writes[0].key, 'favorites');
  assert.deepEqual(f.plugin.favorites.current(), [{ provider: 'giphy', ...nativeProps }]);
});

test('provider settings update live without restarting, and favorites still replace native Giphy', async (t) => {
  const f = fixture(t, { version: 1, gifs: [tenorGif] });
  await f.plugin.favorites.load();
  let originals = 0;
  const element = f.picker(() => {
    originals++;
    return { type: 'native-picker', props: {} };
  }, callbacks());
  let tree = f.render(element);
  assert.equal(originals, 0);
  providerSelect(tree).props.onChange({ target: { value: 'giphy' } });
  tree = f.render(element);
  assert.equal(providerSelect(tree).props.value, 'giphy');
  assert.equal(originals, 1);
  assert.ok(nodes(tree).some((node) => node.type === 'native-picker'));
  const tabs = nodes(tree).filter(
    (node) => node.type === 'button' && node.props['aria-pressed'] !== undefined && !node.props['aria-label'],
  );
  assert.equal(tabs.length, 2);
  tabs[1].props.onClick();
  tree = f.render(element);
  assert.equal(originals, 1);
  assert.ok(nodes(tree).some((node) => node.props['data-bg-select'] === 'true'));
  providerSelect(tree).props.onChange({ target: { value: 'tenor' } });
  tree = f.render(element);
  assert.equal(providerSelect(tree).props.value, 'tenor');
  assert.equal(originals, 1);
  assert.equal(f.patches.length, 2);
  assert.deepEqual(f.settingWrites, [
    ['provider', 'giphy'],
    ['provider', 'tenor'],
  ]);
  assert.deepEqual(f.fetches, []);
});

test('cards animate without hovering, preserve aspect ratios, and offer reduced-motion previews', async (t) => {
  const small = { ...tenorGif, animationUrl: 'https://media.tenor.com/cat-tiny.gif' };
  const wide = { ...tenorGif, id: '2', width: 640, height: 240 };
  const tall = { ...tenorGif, id: '3', width: 200, height: 480 };
  const f = fixture(t, { version: 1, gifs: [small, wide, tall] });
  await f.plugin.favorites.load();
  const element = f.picker(() => assert.fail('Favorites must not mount Original'), callbacks());
  let tree = f.render(element);
  const tabs = nodes(tree).filter(
    (node) => node.type === 'button' && node.props['aria-pressed'] !== undefined && !node.props['aria-label'],
  );
  tabs[1].props.onClick();
  tree = f.render(element);
  const cards = nodes(tree).filter((node) => node.props['data-bg-select'] === 'true');
  assert.deepEqual(
    cards.map((node) => node.props.style.aspectRatio),
    ['320 / 240', '640 / 240', '200 / 480'],
  );
  assert.deepEqual(
    nodes(tree)
      .filter((node) => node.type === 'img')
      .map((node) => node.props.src),
    [small.animationUrl, wide.url, tall.url],
  );
  for (const source of nodes(tree).filter((node) => node.type === 'source')) {
    assert.equal(source.props.media, '(prefers-reduced-motion: reduce)');
    assert.equal(source.props.srcSet, tenorGif.previewUrl);
  }
  assert.equal(cards[0].props.onMouseEnter, undefined);
  const image = find(tree, (node) => node.type === 'img');
  assert.equal(image.props.loading, 'lazy');
  image.props.onError();
  tree = f.render(element);
  assert.equal(nodes(tree).filter((node) => node.type === 'img').length, 2);
  assert.equal(find(tree, (node) => node.props.className === 'slick-bg__fallback').props.children, 'Happy cat');
  assert.deepEqual(f.fetches, []);
});

test('masonry columns distribute GIFs in result order without forcing shared row heights', async (t) => {
  const gifs = Array.from({ length: 6 }, (_, index) => ({
    ...tenorGif,
    id: String(index + 1),
    width: 120,
    height: 80 + index * 20,
  }));
  const f = fixture(t, { version: 1, gifs });
  await f.plugin.favorites.load();
  const element = f.picker(() => null, callbacks());
  let tree = f.render(element);
  nodes(tree)
    .filter((node) => node.type === 'button' && node.props['aria-pressed'] !== undefined)[1]
    .props.onClick();
  tree = f.render(element);
  const columns = nodes(tree).filter((node) => node.props.className === 'slick-bg__column');
  assert.deepEqual(
    columns.map((column) =>
      nodes(column)
        .filter((node) => node.props['data-bg-select'])
        .map((node) => node.props.style.aspectRatio),
    ),
    [
      ['120 / 80', '120 / 140'],
      ['120 / 100', '120 / 160'],
      ['120 / 120', '120 / 180'],
    ],
  );
});

test('arrow keys navigate masonry by tile position rather than assuming square rows', (t) => {
  const f = fixture(t);
  const tree = f.render(f.picker(() => null, callbacks()));
  const grid = find(tree, (node) => node.props.className === 'slick-bg__grid');
  const focused: number[] = [];
  const buttons = [
    [0, 0, 100, 100],
    [0, 104, 100, 200],
    [104, 0, 100, 200],
    [104, 204, 100, 50],
    [208, 0, 100, 140],
  ].map(([left, top, width, height], index) => ({
    getBoundingClientRect: () => ({ left, top, width, height }),
    focus: () => focused.push(index),
  }));
  let prevented = 0;
  const press = (key: string, index: number) =>
    grid.props.onKeyDown({
      key,
      target: buttons[index],
      currentTarget: { querySelectorAll: () => buttons },
      preventDefault: () => prevented++,
    });
  press('ArrowRight', 0);
  press('ArrowLeft', 2);
  press('ArrowDown', 0);
  press('ArrowDown', 2);
  press('ArrowUp', 1);
  press('Home', 3);
  press('End', 0);
  assert.deepEqual(focused, [2, 0, 1, 3, 0, 0, 4]);
  assert.equal(prevented, 7);
  press('Tab', 0);
  press('ArrowUp', 0);
  assert.equal(prevented, 8);
  assert.equal(focused.length, 7, 'At the top edge, focus stays on the current tile');
});

test('search skeletons cover debounce and fetch, then clear on results and errors and reload top on empty query', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const f = fixture(t);
  const pending = deferred<{ status: number; body: string }>();
  f.fetchWith(async () => pending.promise);
  const element = f.picker(() => assert.fail('Tenor must not mount Original'), {
    ...callbacks(),
    emojiSearchQuery: 'cat',
  });
  const skeletons = (tree: any) => nodes(tree).filter((node) => node.props.className === 'slick-bg__skeleton');
  let tree = f.render(element);
  assert.equal(skeletons(tree).length, 9);
  assert.ok(skeletons(tree).every((node) => node.props['aria-hidden'] === 'true'));
  assert.equal(find(tree, (node) => node.props.role === 'status').props.className, 'sr-only');
  assert.equal(find(tree, (node) => node.props.className === 'slick-bg__content').props['aria-busy'], true);
  t.mock.timers.tick(349);
  assert.equal(f.fetches.length, 0);
  t.mock.timers.tick(1);
  assert.equal(skeletons(f.render(element)).length, 9);
  pending.resolve(response());
  await flush();
  tree = f.render(element);
  assert.equal(skeletons(tree).length, 0);
  assert.equal(find(tree, (node) => node.props.className === 'slick-bg__content').props['aria-busy'], false);
  assert.equal(find(tree, (node) => node.type === 'img').props.src, tenorGif.url);
  find(tree, (node) => node.type === 'input').props.onChange({ target: { value: 'fail' } });
  f.fetchWith(async () => {
    throw new Error('Offline');
  });
  tree = f.render(element);
  assert.equal(skeletons(tree).length, 9);
  assert.equal(nodes(tree).filter((node) => node.props['data-bg-select']).length, 0);
  t.mock.timers.tick(350);
  await flush();
  tree = f.render(element);
  assert.equal(skeletons(tree).length, 0);
  assert.ok(nodes(tree).some((node) => node.props.role === 'alert'));
  find(tree, (node) => node.type === 'input').props.onChange({ target: { value: 'next' } });
  tree = f.render(element);
  assert.equal(skeletons(tree).length, 9);
  find(tree, (node) => node.type === 'input').props.onChange({ target: { value: '   ' } });
  tree = f.render(element);
  assert.equal(skeletons(tree).length, 9);
  assert.equal(find(tree, (node) => node.props.role === 'status').props.children, 'Loading top GIFs…');
  f.fetchWith(async () => response());
  t.mock.timers.tick(1);
  await flush();
  assert.equal(f.fetches.at(-1), 'https://tenor-proxy.vercel.app/api/top?limit=50');
  assert.equal(skeletons(f.render(element)).length, 0);
  assert.equal(f.fetches.length, 3);
});

test('empty Tenor search loads and caches homepage GIFs immediately and ignores stale top results', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const f = fixture(t);
  const top = deferred<{ status: number; body: string }>();
  f.fetchWith(async (url) =>
    new URL(url).pathname === '/api/top' ? top.promise : response([{ ...tenorResult, title: 'Search cat' }]),
  );
  const element = f.picker(() => assert.fail('Tenor must replace Original'), callbacks());
  let tree = f.render(element);
  assert.equal(find(tree, (node) => node.props.role === 'status').props.children, 'Loading top GIFs…');
  t.mock.timers.tick(1);
  assert.deepEqual(f.fetches, ['https://tenor-proxy.vercel.app/api/top?limit=50']);
  find(tree, (node) => node.type === 'input').props.onChange({ target: { value: 'cat' } });
  f.render(element);
  t.mock.timers.tick(350);
  await flush();
  tree = f.render(element);
  assert.equal(find(tree, (node) => node.props['data-bg-select']).props.title, 'Search cat');
  top.resolve(response([{ ...tenorResult, title: 'Homepage cat' }]));
  await flush();
  tree = f.render(element);
  assert.equal(find(tree, (node) => node.props['data-bg-select']).props.title, 'Search cat');
  find(tree, (node) => node.type === 'input').props.onChange({ target: { value: '' } });
  f.render(element);
  t.mock.timers.tick(1);
  await flush();
  tree = f.render(element);
  assert.equal(find(tree, (node) => node.props['data-bg-select']).props.title, 'Homepage cat');
  assert.equal(f.fetches.length, 2, 'Top results reused from cache');
});

test('default favorites tab searches locally across providers and retains separate queries', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const f = fixture(
    t,
    { version: 1, gifs: [tenorGif, { provider: 'giphy', ...nativeProps }] },
    { provider: 'tenor', defaultView: 'favorites' },
  );
  await f.plugin.favorites.load();
  f.fetchWith(async () => response());
  const element = f.picker(() => null, { ...callbacks(), emojiSearchQuery: 'cat' });
  let tree = f.render(element);
  const input = () => find(tree, (node) => node.type === 'input');
  const titles = () =>
    nodes(tree)
      .filter((node) => node.props['data-bg-select'])
      .map((node) => node.props.title);
  assert.equal(input().props['aria-label'], 'Search favorite GIFs');
  assert.equal(input().props.value, '');
  assert.equal(titles().length, 2);
  input().props.onChange({ target: { value: 'GIPHY DOG' } });
  tree = f.render(element);
  assert.deepEqual(titles(), ['Waving dog']);
  input().props.onChange({ target: { value: 'not found' } });
  tree = f.render(element);
  assert.equal(find(tree, (node) => node.props.role === 'status').props.children, 'No favorites match your search.');
  t.mock.timers.tick(350);
  assert.deepEqual(f.fetches, []);
  const tabs = () => nodes(tree).filter((node) => node.props.className === 'c-button-unstyled slick-bg__tab');
  tabs()[0].props.onClick();
  tree = f.render(element);
  assert.equal(input().props.value, 'cat');
  t.mock.timers.tick(350);
  await flush();
  tree = f.render(element);
  tabs()[1].props.onClick();
  tree = f.render(element);
  assert.equal(input().props.value, 'not found');
  assert.equal(f.fetches.length, 1);
  assert.equal(f.plugin.favorites.current().length, 2);
});

test('default view applies on reopening, not by overriding a currently chosen tab', (t) => {
  const f = fixture(t);
  const original = () => null;
  const element = f.picker(original, callbacks());
  let tree = f.render(element);
  assert.equal(find(tree, (node) => node.type === 'input').props['aria-label'], 'Search GIFs on Tenor');
  f.config.defaultView = 'favorites';
  f.plugin.onSettingsChange(['defaultView']);
  tree = f.render(element);
  assert.equal(find(tree, (node) => node.type === 'input').props['aria-label'], 'Search GIFs on Tenor');
  f.render(null);
  tree = f.render(f.picker(original, callbacks()));
  assert.equal(find(tree, (node) => node.type === 'input').props['aria-label'], 'Search favorite GIFs');
  assert.deepEqual(f.fetches, []);
});

test('search deduplicates normalized in-flight queries and caches only completed responses', async (t) => {
  const f = fixture(t);
  const bridge = deferred<{ status: number; body: string }>();
  f.fetchWith(async () => bridge.promise);
  const first = f.plugin.search('  happy   cats ');
  const second = f.plugin.search('happy cats');
  assert.equal(first, second);
  assert.equal(f.fetches.length, 1);
  assert.equal(f.plugin.searches.size, 0);
  bridge.resolve(response());
  const results = await first;
  assert.deepEqual(results, [tenorGif]);
  assert.equal(await second, results);
  assert.equal(await f.plugin.search('happy   cats'), results);
  assert.equal(f.fetches.length, 1);
  assert.equal(f.plugin.inflight.size, 0);
});

test('expired search cache is refreshed and fresh results replace stale entries', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture(t);
  let requests = 0;
  f.fetchWith(async () => response([{ ...tenorResult, id: String(++requests) }]));
  const first = await f.plugin.search('cat');
  t.mock.timers.tick(10 * 60_000 - 1);
  assert.equal(await f.plugin.search('cat'), first);
  assert.equal(requests, 1);
  t.mock.timers.tick(1);
  const second = await f.plugin.search('cat');
  assert.equal(requests, 2);
  assert.equal(second[0].id, '2');
  assert.notEqual(second, first);
  assert.equal(await f.plugin.search('cat'), second);
});

test('failed searches clear in-flight state, are not cached, and can be retried', async (t) => {
  const f = fixture(t);
  f.fetchWith(async () => {
    throw new Error('Bridge unavailable');
  });
  const first = f.plugin.search('cat');
  assert.equal(f.plugin.search('cat'), first);
  await assert.rejects(first, /network request failed/);
  assert.equal(f.plugin.inflight.size, 0);
  assert.equal(f.plugin.searches.size, 0);
  f.fetchWith(async () => response());
  assert.deepEqual(await f.plugin.search('cat'), [tenorGif]);
  assert.equal(f.fetches.length, 2);
});

test('search cache stays bounded, and aborted/stopped plugins do not retain late results', async (t) => {
  const f = fixture(t);
  f.fetchWith(async () => response());
  for (let index = 0; index < 21; index++) await f.plugin.search(`cat ${index}`);
  assert.equal(f.plugin.searches.size, 20);
  assert.equal(f.plugin.searches.has('cat 0'), false);
  const late = deferred<{ status: number; body: string }>();
  f.fetchWith(async () => late.promise);
  const pending = f.plugin.search('late');
  f.controller.abort();
  f.plugin.stop();
  late.resolve(response());
  await pending;
  assert.equal(f.plugin.searches.size, 0);
  assert.equal(f.plugin.inflight.size, 0);
});

test('debounced searches ignore an older completion after the query changes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const f = fixture(t);
  const old = deferred<{ status: number; body: string }>();
  const current = deferred<{ status: number; body: string }>();
  f.fetchWith(async (url) => (new URL(url).searchParams.get('q') === 'old' ? old.promise : current.promise));
  const element = f.picker(() => assert.fail('Tenor must not mount Original'), {
    ...callbacks(),
    emojiSearchQuery: 'old',
  });
  let tree = f.render(element);
  t.mock.timers.tick(350);
  find(tree, (node) => node.type === 'input').props.onChange({ target: { value: 'new' } });
  f.render(element);
  t.mock.timers.tick(350);
  current.resolve(response([{ ...tenorResult, id: '2', title: 'New cat' }]));
  await flush();
  tree = f.render(element);
  assert.equal(find(tree, (node) => node.props['data-bg-select'] === 'true').props.title, 'New cat');
  old.resolve(response([{ ...tenorResult, id: '1', title: 'Old cat' }]));
  await flush();
  tree = f.render(element);
  assert.equal(find(tree, (node) => node.props['data-bg-select'] === 'true').props.title, 'New cat');
  assert.equal(f.fetches.length, 2);
});
