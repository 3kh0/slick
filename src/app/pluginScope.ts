export type PluginScope = {
  signal: AbortSignal;
  track(cleanup: () => void): () => void;
  dispose(): void;
};

/** Own only live resources, releasing callback captures as soon as they stop. */
export function createScope(): PluginScope {
  let active = true;
  const controller = new AbortController();
  const cleanups = new Set<() => void>();

  return {
    signal: controller.signal,
    track(cleanup) {
      let pending: (() => void) | null = cleanup;
      const once = () => {
        const run = pending;
        if (!run) return;
        // Clear ownership before user code: cleanup may throw, recurse or
        // dispose another registration. Retained disposers hold no callback.
        pending = null;
        cleanups.delete(once);
        run();
      };
      if (active) cleanups.add(once);
      else once();
      return once;
    },
    dispose() {
      if (!active) return;
      active = false;
      controller.abort();
      for (const cleanup of [...cleanups].toReversed()) {
        try {
          cleanup();
        } catch (error) {
          console.error('[slick] error disposing plugin resource:', error);
        }
      }
    },
  };
}
