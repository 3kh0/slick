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
const { default: WhoReacted } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

type Element = { type: string | ((props: any) => Element | null); props: any; children: any[] };

function fixture(run: (f: ReturnType<typeof setup>) => void) {
  const previousReact = (globalThis as any).React;
  (globalThis as any).React = {
    createContext: (value: unknown) => ({ current: value }),
    useContext: (context: { current: unknown }) => context.current,
    useState: (value: unknown) => [value, () => {}],
    createElement: (type: Element['type'], props: any, ...children: any[]): Element => ({ type, props, children }),
  };
  try {
    run(setup());
  } finally {
    (globalThis as any).React = previousReact;
  }
}

function setup() {
  const workspaces: Record<string, Record<string, string>> = {
    first: { U1: 'https://example.com/first.png' },
    second: { U2: 'https://example.com/second.png' },
  };
  let workspace = 'first';
  const nativeProps: any[] = [];
  const plugin = new WhoReacted(
    {
      elements: {
        Avatar: (props: any): Element => {
          nativeProps.push(props);
          return { type: 'img', props: { src: workspaces[workspace]?.[props.userId] }, children: [] };
        },
      },
      members: {
        useMember: (userId: string) => {
          const url = workspaces.first?.[userId];
          return url ? { profile: { image_24: url } } : undefined;
        },
      },
    },
    { maxAvatars: 2 },
  );
  function render(value: any): Element[] {
    if (Array.isArray(value)) return value.flatMap(render);
    if (!value || typeof value !== 'object') return [];
    if (typeof value.type === 'function')
      return render(value.type(value.children.length ? { ...value.props, children: value.children } : value.props));
    return [value, ...value.children.flatMap(render)];
  }
  return {
    plugin,
    nativeProps,
    switchWorkspace: (next: string) => {
      workspace = next;
    },
    images: (userId: string) => render(plugin.Avatar({ userId })).filter((element) => element.type === 'img'),
    reactors: (users: string[]) => {
      plugin.ReactorsContext.current = users;
      return render(plugin.Reactors());
    },
  };
}

test('reaction avatars follow their native workspace context without reloading the plugin', () => {
  fixture((f) => {
    assert.equal(f.images('U1')[0]?.props.src, 'https://example.com/first.png');
    f.switchWorkspace('second');
    assert.equal(f.images('U2')[0]?.props.src, 'https://example.com/second.png');
    f.switchWorkspace('first');
    assert.equal(f.images('U1')[0]?.props.src, 'https://example.com/first.png');
  });
});

test('avatars remain decorative inside Slack’s reaction button', () => {
  fixture((f) => {
    f.images('U1');
    assert.deepEqual(f.nativeProps[0], {
      userId: 'U1',
      size: 16,
      isInteractive: false,
      showCard: false,
      showTooltip: false,
      tabIndex: -1,
      ariaHidden: 'true',
    });
  });
});

test('avatar limits and the overflow count survive the native avatar renderer', () => {
  fixture((f) => {
    assert.equal(f.reactors([]).length, 0);
    const elements = f.reactors(['U1', 'U2', 'U3', 'U4']);
    assert.equal(elements.filter((element) => element.type === 'img').length, 2);
    assert.deepEqual(elements.find((element) => element.props?.className === 'slick-wr__more')?.children, ['+', 2]);
  });
});
