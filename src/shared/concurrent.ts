/** Keep large disk batches from monopolizing the worker pool and file descriptors. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  work: (item: T) => Promise<R>,
  concurrency = 16,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('Invalid concurrency');
  const results: R[] = [];
  let next = 0;
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]);
      }
    }),
  );
  const failure = workers.find((worker) => worker.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return results;
}
