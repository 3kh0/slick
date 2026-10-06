import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rewriteSelectorList, selectorRewriter } from './selectors.ts';

test('splits a rightmost :is() of classes into an indexable list', () => {
  assert.equal(
    rewriteSelectorList(':is(.c-coachmark--top, .c-coachmark--top-left)::after'),
    '.c-coachmark--top::after, .c-coachmark--top-left::after',
  );
});

test('keeps the ancestor part and other list entries as written', () => {
  assert.equal(
    rewriteSelectorList('.danger, .danger :is(.c-icon, .c-menu_item__icon)'),
    '.danger, .danger .c-icon, .danger .c-menu_item__icon',
  );
  assert.equal(rewriteSelectorList(':is(.a, .b) > :is(.c, .d)'), ':is(.a, .b) > .c, :is(.a, .b) > .d');
});

test('pads arguments to the :is() specificity by repeating a class', () => {
  assert.equal(
    rewriteSelectorList(':is(.bottom, .refurbish.bottom-left)::before'),
    '.bottom.bottom::before, .refurbish.bottom-left::before',
  );
});

test('leaves selectors it cannot prove equivalent', () => {
  assert.equal(rewriteSelectorList('.a :is(.b .c, .d)'), null);
  assert.equal(rewriteSelectorList(':is(div, .d)'), null);
  assert.equal(rewriteSelectorList(':is(.a:hover, .b)'), null);
  assert.equal(rewriteSelectorList('.x:is(.a, .b)'), null);
  assert.equal(rewriteSelectorList(':where(.a, .b)'), null);
  assert.equal(rewriteSelectorList(':is(.a\\:b, .c)'), null);
  assert.equal(rewriteSelectorList('& :is(.a, .b)'), null);
  assert.equal(rewriteSelectorList('.plain .selector'), null);
});

test('ignores commas inside attribute values and nested parens', () => {
  assert.equal(
    rewriteSelectorList('[data-x="a,b"] :is(.a, .b), .y:not(.p, .q)'),
    '[data-x="a,b"] .a, [data-x="a,b"] .b, .y:not(.p, .q)',
  );
});

test('queues rewrites until flushed, skips rules changed meanwhile, and restores', () => {
  const rule = (selectorText: string) => ({ selectorText }) as CSSStyleRule;
  const a = rule(':is(.a, .b)');
  const b = rule(':is(.c, .d)');
  const plain = rule('.plain');
  const rewriter = selectorRewriter();
  assert.equal(rewriter.visit(a), '.a, .b');
  assert.equal(rewriter.visit(b), '.c, .d');
  assert.equal(rewriter.visit(plain), '.plain');
  assert.equal(a.selectorText, ':is(.a, .b)', 'visiting does not mutate the sheet');
  b.selectorText = '.slack-changed';
  rewriter.flush();
  assert.equal(a.selectorText, '.a, .b');
  assert.equal(b.selectorText, '.slack-changed');
  assert.equal(rewriter.visit(a), '.a, .b', 'a rewritten rule is not queued again');
  rewriter.restore();
  assert.equal(a.selectorText, ':is(.a, .b)');
  assert.equal(b.selectorText, '.slack-changed');

  const pending = rule(':is(.e, .f)');
  rewriter.visit(pending);
  rewriter.restore();
  rewriter.flush();
  assert.equal(pending.selectorText, ':is(.e, .f)', 'restore discards queued rewrites');
});
