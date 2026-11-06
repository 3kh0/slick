/** Bound pending IO while preserving input order, including when tasks finish out of order. */
export async function mapConcurrent<T, U>(
  values: readonly T[],
  concurrency: number,
  work: (value: T, index: number) => Promise<U>,
): Promise<U[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('concurrency must be a positive integer');
  const results: U[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        results[index] = await work(values[index], index);
      }
    }),
  );
  return results;
}
