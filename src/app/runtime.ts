// Deferred desktop runtime loaded asynchronously after early.ts has installed
// synchronous hooks on Slack's globals.

import { earlyCore } from './coreClaim.ts';

async function startRuntime() {
  const bridge = earlyCore?.claimed;
  if (!bridge) return;

  const [{ bootstrap }, { patchingReady }, { getStore, reduxReady }, { stats: webpackStats }] = await Promise.all([
    import('./bootstrap.ts'),
    import('./slack/react.tsx'),
    import('./slack/redux.ts'),
    import('./slack/webpack.ts'),
  ]);

  void patchingReady.then(async () => {
    await reduxReady;
    console.log(
      `[slick] React patched, ${webpackStats().modules} modules seen, store ${getStore() ? 'found' : 'not found yet'}`,
    );
    try {
      await bootstrap(bridge);
    } catch (error) {
      console.error('[slick] bootstrap failed; Slack keeps running:', error);
    }
  });
}

void startRuntime();
