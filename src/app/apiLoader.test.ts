import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAPILoader } from './apiLoader.ts';

test('a CSS-only plugin starts without initiating unresolved optional integrations', async () => {
  let calls = 0;
  const load = createAPILoader({
    blocks: () => {
      calls++;
      return new Promise<never>(() => {});
    },
  });
  const api = await load([]);
  assert.equal(calls, 0);
  assert.throws(() => api.blocks, /declare requiredAPIs/);
});

test('concurrent plugins share discovery and retain separate API declarations', async () => {
  let calls = 0;
  const service = { available: true };
  const load = createAPILoader({
    members: async () => {
      calls++;
      return service;
    },
    blocks: async () => ({}),
  });
  const [a, b] = await Promise.all([load(['members']), load(['members'])]);
  assert.equal(calls, 1);
  assert.equal(a.members, service);
  assert.equal(b.members, service);
  assert.throws(() => a.blocks, /declare requiredAPIs/);
});

test('failed optional discovery does not prevent unrelated plugins from starting', async () => {
  const load = createAPILoader({
    bad: async () => {
      throw new Error('missing');
    },
    good: async () => 42,
  });
  await assert.rejects(load(['bad']), /missing/);
  assert.equal((await load(['good'])).good, 42);
});
