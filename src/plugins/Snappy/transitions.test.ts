import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { overrideTransitions } from './transitions.ts';

function fixture(t: TestContext) {
  let now = 0;
  let next = 0;
  const timers = new Map<number, () => void>();
  const idle = new Map<number, IdleRequestCallback>();
  class Rule {
    selectorText: string;
    constructor(selectorText: string) {
      this.selectorText = selectorText;
    }
    style = { getPropertyValue: (name: string) => (name === 'transition-duration' ? '100ms' : '') };
  }
  const rules = Array.from({ length: 20 }, (_, i) => new Rule(`.item-${i}`));
  const globals = {
    CSSStyleRule: Rule,
    document: {
      querySelector: () => ({}),
      styleSheets: [
        { ownerNode: { dataset: { slickStyle: 'user' } }, cssRules: [new Rule('.slick-owned')] },
        { cssRules: [{ cssRules: rules }] },
      ],
    },
    requestIdleCallback: (cb: IdleRequestCallback) => {
      const id = ++next;
      idle.set(id, cb);
      return id;
    },
    cancelIdleCallback: (id: number) => idle.delete(id),
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.method(performance, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (cb: () => void) => {
    const id = ++next;
    timers.set(id, cb);
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', (id: number) => timers.delete(id));
  const runTimer = () => {
    const [id, cb] = timers.entries().next().value!;
    timers.delete(id);
    cb();
  };
  const runIdle = () => {
    const [id, cb] = idle.entries().next().value!;
    idle.delete(id);
    cb({ didTimeout: true, timeRemaining: () => 50 });
  };
  const flushes: number[] = [];
  const rewriter = {
    visit: (rule: { selectorText: string }) => {
      now += 1;
      return rule.selectorText.replace('.item-', '.fast-');
    },
    flush: () => flushes.push(now),
  };
  return { idle, timers, runTimer, runIdle, rewriter, flushes, tick: () => (now += 1) };
}

test('yields even after an idle timeout, walks nested rules, and skips Slick styles', (t) => {
  const f = fixture(t);
  const emitted: string[] = [];
  const scan = overrideTransitions((css) => emitted.push(css), f.rewriter);
  f.runTimer();
  f.runIdle();
  assert.equal(emitted.length, 0, 'one idle callback cannot finish the whole sheet');
  assert.equal(f.flushes.length, 0, 'rewrites wait for the whole scan');
  for (let i = 0; i < 10 && !emitted.length; i++) f.runIdle();
  assert.equal(emitted.length, 1);
  assert.equal(f.flushes.length, 1);
  assert.ok(emitted[0].includes('.fast-19'), 'overrides use the rewritten selector');
  assert.ok(!emitted[0].includes('.item-'));
  assert.ok(!emitted[0].includes('.slick-owned'));
  f.runTimer();
  f.runIdle();
  assert.equal(emitted.length, 1, 'unchanged sheets are not emitted again');
  scan.stop();
  assert.equal(f.timers.size, 0);
});

test('stopping a partial scan cancels pending idle work before teardown restores selectors', (t) => {
  const f = fixture(t);
  let visits = 0;
  const scan = overrideTransitions(() => assert.fail('unfinished scan emitted CSS'), {
    visit: (rule) => {
      visits++;
      f.tick();
      return rule.selectorText;
    },
    flush: () => assert.fail('unfinished scan applied rewrites'),
  });
  f.runTimer();
  f.runIdle();
  assert.ok(visits > 0 && visits < 20);
  assert.equal(f.idle.size, 1);
  scan.stop();
  assert.equal(f.idle.size, 0);
  assert.equal(f.timers.size, 0);
});
