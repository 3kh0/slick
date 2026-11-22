import type { SlickBridge } from './bridge.ts';

export const EARLY_CORE_SYMBOL = Symbol.for('slick.earlyCore');

export type EarlyCore = {
  bridge: typeof import('./bridge.ts');
  accounts: typeof import('./api/accounts.ts');
  snappyBoot: typeof import('../plugins/Snappy/boot.ts');
  webpack: typeof import('./slack/webpack.ts');
  react: typeof import('./slack/react.tsx');
  redux: typeof import('./slack/redux.ts');
  rtm: typeof import('./slack/rtm.ts');
  resize: typeof import('./api/resize.ts');
  childWindows: typeof import('./slack/childWindows.ts');
  css: typeof import('./api/css.ts');
  store: typeof import('./store.ts');
  claimed: SlickBridge;
};
