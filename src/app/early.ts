// Runs synchronously in the page before Slack's first script; slick.js later
// claims these module instances via coreClaim.ts.

import * as accounts from './api/accounts.ts';
import * as css from './api/css.ts';
import * as resize from './api/resize.ts';
import * as bridge from './bridge.ts';
import { EARLY_CORE_SYMBOL, type EarlyCore } from './earlyCore.ts';
import * as store from './store.ts';
import * as snappyBoot from '../plugins/Snappy/boot.ts';
import * as childWindows from './slack/childWindows.ts';
import * as react from './slack/react.tsx';
import * as redux from './slack/redux.ts';
import * as rtm from './slack/rtm.ts';
import * as webpack from './slack/webpack.ts';

type Precondition = { name: string; ok: () => boolean; detail: string };

const preconditions: Precondition[] = [
  {
    name: 'slack-client',
    detail: 'not the Slack client',
    ok: () => location.hostname === 'app.slack.com' && /^\/client(\/|$)/.test(location.pathname),
  },
  {
    name: 'bridge',
    detail: 'no SlickBridge: the loader did not expose it',
    ok: () => bridge.getBridge() !== null,
  },
  {
    name: 'before-slack',
    detail: 'Slack loaded before Slick: injected too late to patch anything',
    ok: () => webpack.CHUNK_GLOBALS.every((name) => !(globalThis as Record<string, unknown>)[name]),
  },
];

function startEarly() {
  const version = typeof __SLICK_VERSION__ === 'string' ? __SLICK_VERSION__ : 'dev';

  for (const check of preconditions) {
    let ok = false;
    try {
      ok = check.ok();
    } catch {}
    if (ok) continue;
    const log = check.name === 'slack-client' ? console.log : console.error;
    log(`[slick] not starting (${check.name}): ${check.detail}. Slack will load normally.`);
    return;
  }

  const claimed = bridge.getBridge();
  if (!claimed) return;

  if (claimed.safeMode) {
    console.warn('[slick] safe mode: plugins will not be loaded');
  }

  try {
    accounts.applyPendingAccountSwitch();
    snappyBoot.installStateTrackingOptimization(
      claimed,
      webpack.CHUNK_GLOBALS.some((name) => !!(globalThis as Record<string, unknown>)[name]),
    );
    webpack.installWebpackHooks({ allowExisting: false });
    webpack.exposeDebugGlobals();
    react.exposeDebugGlobals();
    redux.exposeDebugGlobals();
    resize.installResizeGate();
    childWindows.installChildWindows();
    childWindows.onChildWindow(css.registerDocument);
  } catch (error) {
    console.error('[slick] failed to install interception; Slack will run unmodified:', error);
    return;
  }

  const core: EarlyCore = {
    bridge,
    accounts,
    snappyBoot,
    webpack,
    react,
    redux,
    rtm,
    resize,
    childWindows,
    css,
    store,
    claimed,
  };
  Object.defineProperty(globalThis, EARLY_CORE_SYMBOL, {
    value: core,
    configurable: true,
  });

  console.log(`[slick] ${version} running before Slack — preconditions passed`);
}

startEarly();
