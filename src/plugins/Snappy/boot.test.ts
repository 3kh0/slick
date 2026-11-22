import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SNAPPY_OPT_IN, shouldOptimizeStateTracking } from './boot.ts';

test('shouldOptimizeStateTracking supports extension SNAPPY_OPT_IN and respects safe mode', () => {
  const g = globalThis as Record<PropertyKey, unknown>;
  const previous = Object.getOwnPropertyDescriptor(g, SNAPPY_OPT_IN);
  try {
    delete g[SNAPPY_OPT_IN];
    assert.equal(shouldOptimizeStateTracking({ loader: 'extension', safeMode: false }, false), false);
    Object.defineProperty(g, SNAPPY_OPT_IN, { value: true, configurable: true });
    assert.equal(shouldOptimizeStateTracking({ loader: 'extension', safeMode: false }, false), true);
    assert.equal(shouldOptimizeStateTracking({ loader: 'extension', safeMode: true }, false), false);
    assert.equal(shouldOptimizeStateTracking({ loader: 'extension', safeMode: false }, true), false);
  } finally {
    if (previous) Object.defineProperty(g, SNAPPY_OPT_IN, previous);
    else delete g[SNAPPY_OPT_IN];
  }
});
