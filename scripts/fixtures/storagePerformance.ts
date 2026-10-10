// Runs against real IndexedDB on the benchmark server's disposable origin.
import { indexedDbBackend } from '../../src/extension/blobs.ts';

export async function runStoragePerformance() {
  const backend = indexedDbBackend();
  const ns = 'plugin:MessageLogger';
  const limits = { keys: 5000, value: 256000, bytes: 64 * 1024 * 1024 };
  const equal = (actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(JSON.stringify({ actual, expected }));
  };
  const entries: [string, string][] = Array.from({ length: 128 }, (_, i) => [
    `entry:${i}`,
    JSON.stringify({ text: 'x'.repeat(1024), at: i }),
  ]);
  const samples: Record<string, number[]> = { legacy: [], individual: [], batch: [] };
  for (let round = 0; round < 5; round++) {
    for (const method of round % 2 ? ['batch', 'individual', 'legacy'] : ['legacy', 'individual', 'batch']) {
      await backend.clear(ns);
      const start = performance.now();
      if (method === 'legacy') {
        for (const [key, value] of entries) {
          await backend.usage(ns);
          await backend.get(ns, key);
          await backend.put(ns, key, value);
        }
      } else if (method === 'individual') {
        for (const entry of entries) await backend.mutate(ns, [entry], limits);
      } else await backend.mutate(ns, entries, limits);
      samples[method].push(performance.now() - start);
      equal((await backend.usage(ns)).keys, 128);
    }
  }
  await backend.clear(ns);
  await backend.mutate(
    ns,
    [
      ['a', 'first'],
      ['a', 'last'],
      ['__proto__', 'safe'],
    ],
    limits,
  );
  equal(await backend.get(ns, 'a'), 'last');
  equal(await backend.usage(ns), { keys: 2, bytes: 8 });
  let rejected = false;
  try {
    await backend.mutate(
      ns,
      [
        ['a', 'bad'],
        ['b', 'too large'],
      ],
      { ...limits, keys: 2, bytes: 8 },
    );
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('Quota was not enforced');
  equal(await backend.get(ns, 'a'), 'last');
  equal(await backend.get(ns, 'b'), undefined);
  equal(await backend.usage(ns), { keys: 2, bytes: 8 });
  await backend.mutate(
    ns,
    [
      ['a', null],
      ['__proto__', null],
      ['b', 'new'],
    ],
    limits,
  );
  equal(await backend.usage(ns), { keys: 1, bytes: 3 });
  await backend.clear(ns);
  const median = (values: number[]) => values.toSorted((a, b) => a - b)[2];
  return {
    synthetic: true,
    entries: 128,
    legacyTransactions: 384,
    individualTransactions: 128,
    batchTransactions: 1,
    legacyMs: median(samples.legacy),
    individualMs: median(samples.individual),
    batchMs: median(samples.batch),
    rollback: true,
    usageAccounting: true,
  };
}
