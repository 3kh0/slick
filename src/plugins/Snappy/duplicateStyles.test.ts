import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { equivalentRules, equivalentStyles, suppressDuplicateStyles } from './duplicateStyles.ts';

const list = (rules: object[]) => rules as unknown as CSSRuleList;
const style = (cssText: string) => ({ type: 1, cssText });
function matches(a: object[], b: object[]) {
  const work = equivalentRules(list(a), list(b));
  let result = work.next();
  while (!result.done) result = work.next();
  return result.value;
}

test('requires identical declarations and cascade order rather than equal rule counts', () => {
  assert.equal(matches([style('.a { color: red; }')], [style('.a { color: red; }')]), true);
  assert.equal(matches([style('.a { color: red; }')], [style('.a { color: blue; }')]), false);
  assert.equal(matches([style('.a{}'), style('.b{}')], [style('.b{}'), style('.a{}')]), false);
});

test('compares nested conditions and yields while walking large groups', () => {
  const group = (conditionText: string) => ({
    type: 4,
    constructor: { name: 'CSSMediaRule' },
    cssText: `@media ${conditionText} { .a{} .b{} }`,
    conditionText,
    cssRules: list([style('.a{}'), style('.b{}')]),
  });
  assert.equal(matches([group('(min-width: 1px)')], [group('(min-width: 2px)')]), false);
  const scan = equivalentRules(list([group('screen')]), list([group('screen')]));
  assert.equal(scan.next().done, false);
  assert.equal(scan.next().done, false);
  assert.equal(scan.next().done, false);
  assert.deepEqual(scan.next(), { done: true, value: true });
});

test('conditional groups compare their preludes without serializing their descendants', () => {
  const group = (kind: string, conditionText: string) => ({
    type: 0,
    constructor: { name: kind },
    conditionText,
    get cssText(): string {
      throw new Error('group cssText would serialize the entire subtree before yielding');
    },
    cssRules: list([style('.a{}'), style('.b{}')]),
  });
  for (const kind of ['CSSMediaRule', 'CSSSupportsRule', 'CSSContainerRule']) {
    assert.equal(matches([group(kind, 'screen')], [group(kind, 'screen')]), true);
    assert.equal(matches([group(kind, 'screen')], [group(kind, 'print')]), false);
  }
  assert.equal(
    matches([group('CSSContainerRule', 'sidebar (width > 1px)')], [group('CSSContainerRule', 'main (width > 1px)')]),
    false,
    'container names remain part of the condition',
  );
  assert.equal(matches([group('CSSStartingStyleRule', '')], [group('CSSStartingStyleRule', '')]), true);
});

test('preserves layer declarations inside conditions, including braces in a query value', () => {
  const rule = {
    type: 0,
    constructor: { name: 'CSSSupportsRule' },
    conditionText: '(--label: "{")',
    cssRules: list([{ type: 0, constructor: { name: 'CSSLayerStatementRule' }, cssText: '@layer slack;' }]),
  };
  const scan = equivalentStyles(list([rule]), list([rule]));
  let result = scan.next();
  while (!result.done) result = scan.next();
  assert.equal(result.value, '@supports (--label: "{") { @layer slack; }');
});

test('nested style rules compare own declarations and yield before serializing another subtree', () => {
  const nested = (selectorText = '.a', declarations = 'color: red;', children = [style('& .b { color: blue; }')]) => ({
    type: 1,
    selectorText,
    style: { cssText: declarations },
    cssRules: list(children),
    get cssText(): string {
      throw new Error('nested style cssText would serialize all descendants');
    },
  });
  assert.equal(matches([nested()], [nested()]), true);
  assert.equal(matches([nested()], [nested('.different')]), false);
  assert.equal(matches([nested()], [nested('.a', 'color: blue;')]), false);
  assert.equal(matches([nested()], [nested('.a', 'color: red;', [style('& .b { color: red; }')])]), false);
  assert.equal(matches([nested()], [nested('.a', 'color: red;', [])]), false);
  const scan = equivalentRules(list([nested()]), list([nested()]));
  assert.equal(scan.next().done, false);
  assert.equal(scan.next().done, false);
  assert.deepEqual(scan.next(), { done: true, value: true });
});

test('still rejects layers nested in a style rule', () => {
  const rule = {
    type: 1,
    selectorText: '.a',
    style: { cssText: '' },
    cssRules: list([{ type: 0, constructor: { name: 'CSSLayerStatementRule' }, cssText: '@layer slack;' }]),
  };
  assert.equal(matches([rule], [rule]), false);
});

test('keeps keyframe names and vendor prefixes distinct', () => {
  const keyframes = (header: string) => ({
    type: 7,
    constructor: { name: 'CSSKeyframesRule' },
    cssText: `${header} { from { opacity: 0; } }`,
    cssRules: list([{ type: 8, cssText: '0% { opacity: 0; }' }]),
  });
  assert.equal(matches([keyframes('@keyframes fade')], [keyframes('@keyframes fade')]), true);
  assert.equal(matches([keyframes('@keyframes fade')], [keyframes('@keyframes move')]), false);
  assert.equal(matches([keyframes('@keyframes fade')], [keyframes('@-webkit-keyframes fade')]), false);
});

test('imports, namespaces, layers and unsupported rules are never suppressed', () => {
  for (const type of [0, 3, 10, 15, 16]) {
    assert.equal(matches([{ type, cssText: 'same' }], [{ type, cssText: 'same' }]), false);
  }
});

test('named layers preserve their first declaration order; anonymous layers stay enabled', () => {
  const layer = (name: string) => ({
    type: 0,
    constructor: { name: 'CSSLayerBlockRule' },
    name,
    cssRules: list([style('.a{}')]),
  });
  const rules = list([layer('slack')]);
  const scan = equivalentStyles(rules, rules);
  let result = scan.next();
  while (!result.done) result = scan.next();
  assert.equal(result.value, '@layer slack;');
  assert.equal(matches([layer('')], [layer('')]), false);
});

function page(t: TestContext) {
  const timers = new Map<number, () => void>();
  const idle = new Map<number, IdleRequestCallback>();
  const listeners = new Map<string, EventListener>();
  let observe: MutationCallback = () => {};
  let next = 0;
  const link = (href: string, rel = 'stylesheet') => {
    const node = {
      nodeName: 'LINK',
      isConnected: true,
      rel,
      relList: { contains: (token: string) => rel.split(' ').includes(token) },
      title: '',
      hasAttribute: () => false,
      before: () => {},
      sheet: null as unknown,
    };
    node.sheet = { href, media: { mediaText: '' }, disabled: false, cssRules: [style('.a{}')], ownerNode: node };
    return node;
  };
  const doc = {
    hidden: false,
    styleSheets: [] as unknown[],
    head: {},
    createElement: () => ({ dataset: {}, remove() {} }),
    addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const globals = {
    MutationObserver: class {
      constructor(callback: MutationCallback) {
        observe = callback;
      }
      observe() {}
      disconnect() {}
    },
    requestIdleCallback: (cb: IdleRequestCallback) => (idle.set(++next, cb), next),
    cancelIdleCallback: (id: number) => idle.delete(id),
  };
  for (const [name, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const delays: number[] = [];
  t.mock.method(
    globalThis,
    'setTimeout',
    (cb: () => void, ms: number) => (timers.set(++next, cb), delays.push(ms), next),
  );
  t.mock.method(globalThis, 'clearTimeout', (id: number) => timers.delete(id));
  const settle = () => {
    for (let i = 0; i < 100 && (timers.size || idle.size); i++) {
      const due = [...timers];
      timers.clear();
      for (const [, cb] of due) cb();
      const ready = [...idle];
      idle.clear();
      for (const [, cb] of ready) cb({ didTimeout: false, timeRemaining: () => 50 });
      if (timers.size === 1 && !idle.size) break;
    }
  };
  const mutate = (records: object[]) => observe(records as MutationRecord[], {} as MutationObserver);
  const round = () => {
    const due = [...timers];
    timers.clear();
    for (const [, cb] of due) cb();
    while (idle.size) {
      const ready = [...idle];
      idle.clear();
      for (const [, cb] of ready) cb({ didTimeout: false, timeRemaining: () => 50 });
    }
  };
  return { doc, link, timers, delays, listeners, settle, round, mutate };
}

test('releases only pairs whose own links change, and only stylesheet links trigger checks', (t) => {
  const p = page(t);
  const first = p.link('https://cdn/boot.css');
  const second = p.link('https://cdn/boot.css');
  p.doc.styleSheets.push(first.sheet, second.sheet);
  const sheet = (node: ReturnType<typeof p.link>) => node.sheet as { disabled: boolean };
  const duplicates = suppressDuplicateStyles(p.doc as unknown as Document);
  p.settle();
  assert.equal(sheet(first).disabled, true);
  assert.equal(sheet(second).disabled, false);

  const scheduled = p.timers.size;
  p.mutate([{ type: 'attributes', attributeName: 'href', target: p.link('/favicon.png', 'icon') }]);
  assert.equal(p.timers.size, scheduled, 'icon changes do not schedule a comparison');
  assert.equal(p.listeners.has('visibilitychange'), false, 'returning to the tab does not release suppression');

  const other = p.link('https://cdn/lazy.css');
  p.doc.styleSheets.push(other.sheet);
  p.mutate([{ type: 'childList', addedNodes: [other], removedNodes: [] }]);
  assert.equal(sheet(first).disabled, true, 'an unrelated stylesheet does not re-enable the duplicate');
  p.settle();
  assert.equal(sheet(first).disabled, true);

  second.isConnected = false;
  p.doc.styleSheets.splice(1, 1);
  p.mutate([{ type: 'childList', addedNodes: [], removedNodes: [second] }]);
  assert.equal(sheet(first).disabled, false, 'removing the kept copy restores the earlier one before the next frame');

  p.doc.styleSheets.push(second.sheet);
  second.isConnected = true;
  p.settle();
  assert.equal(sheet(first).disabled, true);
  duplicates.stop();
  assert.equal(sheet(first).disabled, false);
});

test('backs off unchanged rechecks and resets when a stylesheet link changes', (t) => {
  const p = page(t);
  const first = p.link('https://cdn/boot.css');
  const second = p.link('https://cdn/boot.css');
  p.doc.styleSheets.push(first.sheet, second.sheet);
  const duplicates = suppressDuplicateStyles(p.doc as unknown as Document);
  for (let i = 0; i < 6; i++) p.round();
  assert.deepEqual(p.delays, [1_000, 30_000, 60_000, 120_000, 240_000, 240_000, 240_000]);
  p.mutate([{ type: 'childList', addedNodes: [p.link('https://cdn/lazy.css')], removedNodes: [] }]);
  p.round();
  assert.deepEqual(p.delays.slice(-2), [1_000, 60_000], 'the backoff restarts after a link change');
  duplicates.stop();
});
