// A handful of vitest-style matchers on node:assert, so the huddle tests can use
// `expect(...)` (Slick runs node:test, not vitest).

import assert from 'node:assert/strict';
import { it } from 'node:test';

export interface MockFunction<Args extends unknown[] = any[]> {
  (...args: Args): void;
  calls: Args[];
}

export function mockFn<Args extends unknown[] = any[]>(): MockFunction<Args> {
  const calls: Args[] = [];
  const fn = ((...args: Args) => void calls.push(args)) as MockFunction<Args>;
  fn.calls = calls;
  return fn;
}

const callsOf = (value: unknown): unknown[][] => {
  const calls = (value as Partial<MockFunction>)?.calls;
  assert.ok(Array.isArray(calls), 'expected a mockFn()');
  return calls;
};

/** Recursive subset match, like vitest's toMatchObject. */
function assertMatchesObject(actual: unknown, expected: unknown, path = 'value'): void {
  if (expected === null || typeof expected !== 'object') return assert.deepEqual(actual, expected, `${path} differs`);
  assert.ok(actual !== null && typeof actual === 'object', `${path} should be an object`);
  for (const [key, value] of Object.entries(expected)) {
    assertMatchesObject((actual as Record<string, unknown>)[key], value, `${path}.${key}`);
  }
}

export function expect(actual: unknown) {
  return {
    toBe: (expected: unknown) =>
      assert.ok(Object.is(actual, expected), `expected ${String(actual)} to be ${String(expected)}`),
    toEqual: (expected: unknown) => assert.deepEqual(actual, expected),
    toBeNull: () => assert.equal(actual, null),
    toMatch: (pattern: RegExp | string) =>
      assert.match(String(actual), typeof pattern === 'string' ? new RegExp(pattern) : pattern),
    toMatchObject: (expected: object) => assertMatchesObject(actual, expected),
    toBeGreaterThan: (bound: number) => assert.ok((actual as number) > bound, `${actual} should be > ${bound}`),
    toBeGreaterThanOrEqual: (bound: number) =>
      assert.ok((actual as number) >= bound, `${actual} should be >= ${bound}`),
    toBeLessThan: (bound: number) => assert.ok((actual as number) < bound, `${actual} should be < ${bound}`),
    toBeLessThanOrEqual: (bound: number) => assert.ok((actual as number) <= bound, `${actual} should be <= ${bound}`),
    toHaveBeenCalledTimes: (count: number) => assert.equal(callsOf(actual).length, count),
    toHaveBeenLastCalledWith: (...args: unknown[]) => assert.deepEqual(callsOf(actual).at(-1), args),
    not: {
      toEqual: (expected: unknown) => assert.notDeepEqual(actual, expected),
      toHaveBeenCalled: () => assert.equal(callsOf(actual).length, 0, 'expected no calls'),
    },
  };
}

/** vitest's `it.each(cases)(title, fn)`: array cases are spread into `fn`, `%s` / `%d` in the title take their values. */
export function itEach<Case>(cases: readonly Case[]) {
  return (title: string, run: (...args: any[]) => void) => {
    for (const testCase of cases) {
      const args = Array.isArray(testCase) ? testCase : [testCase];
      let index = 0;
      it(
        title.replace(/%[sdij]/g, () => String(args[index++])),
        () => run(...args),
      );
    }
  };
}
