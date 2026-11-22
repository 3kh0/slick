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
  const styles: Array<{
    dataset: Record<string, string>;
    textContent: string | null;
    writes: number;
    parentNode: unknown;
    nextElementSibling: unknown;
    remove(): void;
  }> = [];
  const headChildren: Array<
    (typeof styles)[number] | { tag: string; nextElementSibling?: unknown; parentNode?: unknown }
  > = [];
  const syncLinks = () => {
    for (let i = 0; i < headChildren.length; i++) {
      const node = headChildren[i] as { parentNode?: unknown; nextElementSibling?: unknown };
      node.parentNode = head;
      node.nextElementSibling = headChildren[i + 1] ?? null;
    }
  };
  const makeStyle = (key = '', initialText: string | null = null) => {
    let text = initialText;
    const el = {
      dataset: key ? { slickStyle: key } : ({} as Record<string, string>),
      writes: 0,
      parentNode: null as unknown,
      nextElementSibling: null as unknown,
      get textContent() {
        return text;
      },
      set textContent(value: string | null) {
        el.writes++;
        text = value;
      },
      remove() {
        const idx = headChildren.indexOf(el);
        if (idx >= 0) headChildren.splice(idx, 1);
        const sIdx = styles.indexOf(el);
        if (sIdx >= 0) styles.splice(sIdx, 1);
        el.parentNode = null;
        el.nextElementSibling = null;
        syncLinks();
      },
    };
    return el;
  };
  const head = {
    appendChild(el: (typeof styles)[number]) {
      const existing = headChildren.indexOf(el);
      if (existing >= 0) headChildren.splice(existing, 1);
      headChildren.push(el);
      if (!styles.includes(el)) styles.push(el);
      syncLinks();
      return el;
    },
  };
  const primary = {
    head,
    headChildren,
    styles,
    preInject(key: string, cssText: string, trailingSibling = false) {
      const el = makeStyle(key, cssText);
      head.appendChild(el);
      if (trailingSibling) {
        headChildren.push({ tag: 'style' });
        syncLinks();
      }
      return el;
    },
    createElement: () => makeStyle(),
    querySelector: (selector: string) => {
      const match = /^style\[data-slick-style="(.+)"\]$/.exec(selector);
      if (!match) return null;
      const key = match[1].replace(/\\(.)/g, '$1');
      return styles.find((s) => s.dataset.slickStyle === key) ?? null;
    },
  };
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
  return { api: context.Styles, primary, child };
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

test('setStyle adopts pre-injected style elements without rewriting identical CSS and removes them on null', () => {
  const { api, primary } = fixture();
  const preUser = primary.preInject('user', 'body{color:red}', false);
  const disposeUser = api.setStyle('body{color:red}', 'user');
  assert.equal(primary.styles.length, 1);
  assert.equal(preUser.writes, 0);

  // Move to end of head if later stylesheets were appended after pre-injection.
  const preTheme = primary.preInject('theme', ':root{--a:1}', true);
  assert.notEqual(preTheme.nextElementSibling, null);
  api.setStyle(':root{--a:1}', 'theme');
  assert.equal(preTheme.nextElementSibling, null);
  assert.equal(preTheme.writes, 0);

  disposeUser();
  assert.equal(primary.querySelector('style[data-slick-style="user"]'), null);

  // Clearing an unadopted pre-injected sheet still removes it.
  primary.preInject('stale', 'body{}', false);
  api.setStyle(null, 'stale');
  assert.equal(primary.querySelector('style[data-slick-style="stale"]'), null);
});
