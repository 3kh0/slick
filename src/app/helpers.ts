// Small utilities shared across the app bundle.

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `attempt` until it produces a value, backing off exponentially with full
 * jitter. Used for reads that depend on Slack having fetched something: the
 * first try usually misses, and a tight retry would just hammer the store.
 */
export async function retry<T>(
  attempt: () => Promise<T | undefined>,
  { tries = 3, baseMs = 1000, maxMs = 30_000 }: { tries?: number; baseMs?: number; maxMs?: number } = {},
): Promise<T | undefined> {
  for (let i = 0; ; i++) {
    const result = await attempt();
    if (result !== undefined || i >= tries - 1) return result;
    await sleep(Math.random() * Math.min(maxMs, baseMs * 2 ** i));
  }
}
