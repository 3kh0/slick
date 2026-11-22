import { earlyCore } from './coreClaim.ts';

const bridge = earlyCore?.claimed;
if (bridge) {
  void Promise.all([
    import('./bootstrap.ts'),
    import('./slack/react.tsx'),
    import('./slack/redux.ts'),
    import('./slack/webpack.ts'),
  ]).then(([{ bootstrap }, { patchingReady }, { getStore, reduxReady }, { stats }]) =>
    patchingReady.then(async () => {
      await reduxReady;
      console.log(
        `[slick] React patched, ${stats().modules} modules seen, store ${getStore() ? 'found' : 'not found yet'}`,
      );
      try {
        await bootstrap(bridge);
      } catch (e) {
        console.error('[slick] bootstrap failed; Slack keeps running:', e);
      }
    }),
  );
}
