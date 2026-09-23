export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry until `attempt` produces a value, with exponential backoff and full jitter. */
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
