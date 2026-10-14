import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/app/api/css.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'Styles',
});

function fixture() {
  const primary = {};
  const context = createContext({ document: primary, console });
  runInContext(bundle.outputFiles[0]!.text, context);
  function child() {
    const view = Object.assign(new EventTarget(), { closed: false });
    const doc = { defaultView: view };
    return {
      doc,
      view,
      hide(persisted = false) {
        view.dispatchEvent(Object.assign(new Event('pagehide'), { persisted }));
      },
    };
  }
  return { api: context.Styles, child };
}

test('CSS document registry releases a navigated pop-out even before its window closes', () => {
  const { api, child } = fixture();
  const popup = child();
  api.registerDocument(popup.doc);
  popup.hide();
  const notified: unknown[] = [];
  const stop = api.onDocument((doc: unknown) => notified.push(doc));
  assert.equal(notified.length, 0);
  stop();
});

test('CSS document registry retains persisted pages and releases them on final pagehide', () => {
  const { api, child } = fixture();
  const popup = child();
  api.registerDocument(popup.doc);
  popup.hide(true);
  const notified: unknown[] = [];
  api.onDocument((doc: unknown) => notified.push(doc))();
  assert.equal(notified.length, 1);
  assert.equal(notified[0], popup.doc);
  popup.hide(false);
  api.onDocument((doc: unknown) => notified.push(doc))();
  assert.equal(notified.length, 1);
});

test('fallback pruning removes closed documents rather than only filtering the result', () => {
  const { api, child } = fixture();
  const popup = child();
  api.registerDocument(popup.doc);
  popup.view.closed = true;
  const notified: unknown[] = [];
  const stop = api.onDocument((doc: unknown) => notified.push(doc));
  assert.equal(notified.length, 0);
  // Re-registration proves the old document was removed from the strong Set.
  popup.view.closed = false;
  api.registerDocument(popup.doc);
  assert.equal(notified.length, 1);
  assert.equal(notified[0], popup.doc);
  stop();
});
