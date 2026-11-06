import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/app/slack/childWindows.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'Children',
  plugins: [
    {
      name: 'window-harness',
      setup(builder) {
        builder.onLoad({ filter: /\/webpack\.ts$/ }, () => ({
          contents: 'export const patchExportFunction = (name, wrap) => globalThis.copyStyles = wrap(async () => {});',
          loader: 'js',
        }));
        builder.onLoad({ filter: /\/childWindowQuill\.ts$/ }, () => ({
          contents: 'export const installChildWindowQuill = () => {};',
          loader: 'js',
        }));
      },
    },
  ],
});

test('transparent sharing overlays are not registered for mirrored styles; ordinary pop-outs still are', async () => {
  const primary = {};
  const window = {
    open: (..._args: unknown[]) => Object.assign(new EventTarget(), { document: {}, closed: false }),
  };
  const context = createContext({
    window,
    document: primary,
    console,
    setTimeout: () => 0,
  });
  runInContext(bundle.outputFiles[0]!.text, context);
  const children = context.Children;
  children.installChildWindows();
  let registered = 0;
  children.onChildWindow(() => registered++);
  for (const value of ['yes', 'true', '1']) {
    const overlay = window.open('', '', `frame=no,transparent=${value},alwaysOnTop=yes`);
    await context.copyStyles(primary, { defaultView: overlay });
    assert.equal(registered, 0);
  }
  const popup = window.open('', '', 'transparent=no');
  await context.copyStyles(primary, { defaultView: popup });
  assert.equal(registered, 1);
});
