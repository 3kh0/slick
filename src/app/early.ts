import * as accounts from './api/accounts.ts';
import * as css from './api/css.ts';
import * as resize from './api/resize.ts';
import * as bridge from './bridge.ts';
import * as store from './store.ts';
import * as snappyBoot from '../plugins/Snappy/boot.ts';
import * as childWindows from './slack/childWindows.ts';
import * as react from './slack/react.tsx';
import * as redux from './slack/redux.ts';
import * as rtm from './slack/rtm.ts';
import * as webpack from './slack/webpack.ts';

const core = { bridge, accounts, snappyBoot, webpack, react, redux, rtm, resize, childWindows, css, store };
export type EarlyCore = typeof core & { claimed: bridge.SlickBridge };

(() => {
  const g = globalThis as Record<PropertyKey, unknown>;
  const v = typeof __SLICK_VERSION__ === 'string' ? __SLICK_VERSION__ : 'dev';
  const checks: [string, string, () => boolean][] = [
    [
      'slack-client',
      'not the Slack client',
      () => location.hostname === 'app.slack.com' && /^\/client(\/|$)/.test(location.pathname),
    ],
    ['bridge', 'no SlickBridge: the loader did not expose it', () => bridge.getBridge() !== null],
    [
      'before-slack',
      'Slack loaded before Slick: injected too late to patch anything',
      () => webpack.CHUNK_GLOBALS.every((n) => !g[n]),
    ],
  ];
  for (const [name, detail, test] of checks) {
    let ok = false;
    try {
      ok = test();
    } catch {}
    if (!ok) {
      (name === 'slack-client' ? console.log : console.error)(
        `[slick] not starting (${name}): ${detail}. Slack will load normally.`,
      );
      return;
    }
  }
  const c = bridge.getBridge();
  if (!c) return;
  if (c.safeMode) console.warn('[slick] safe mode: plugins will not be loaded');
  try {
    accounts.applyPendingAccountSwitch();
    snappyBoot.installStateTrackingOptimization(
      c,
      webpack.CHUNK_GLOBALS.some((n) => !!g[n]),
    );
    webpack.installWebpackHooks({ allowExisting: false });
    webpack.exposeDebugGlobals();
    react.exposeDebugGlobals();
    redux.exposeDebugGlobals();
    resize.installResizeGate();
    childWindows.installChildWindows();
    childWindows.onChildWindow(css.registerDocument);
  } catch (e) {
    console.error('[slick] failed to install interception; Slack will run unmodified:', e);
    return;
  }
  Object.defineProperty(g, Symbol.for('slick.earlyCore'), { value: { ...core, claimed: c }, configurable: true });
  console.log(`[slick] ${v} running before Slack — preconditions passed`);
})();
