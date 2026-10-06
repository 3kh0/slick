import assert from 'node:assert/strict';
import { test } from 'node:test';
import { equivalentRules, equivalentStyles } from './duplicateStyles.ts';

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
