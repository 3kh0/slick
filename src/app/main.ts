// Runs as the first script in Slack's rebuilt document. Any failed
// precondition means do nothing: a half-started Slick can stop Slack booting.

import { applyPendingAccountSwitch } from './api/accounts.ts';
import { registerDocument } from './api/css.ts';
import { installResizeGate } from './api/resize.ts';
import { bootstrap } from './bootstrap.ts';
// Extension entries must import their bridge-setup side effect before this module.
// bridge.ts claims the preinstalled SlickBridge synchronously during evaluation.
import { getBridge } from './bridge.ts';
import { installChildWindows, onChildWindow } from './slack/childWindows.ts';
import { exposeDebugGlobals as exposeReactDebug, patchingReady } from './slack/react.tsx';
// Side effects: redux.ts wraps createStore and the thunk factory at module
// scope, before Slack loads.
import { exposeDebugGlobals as exposeReduxDebug, getStore, reduxReady } from './slack/redux.ts';
// Same for rtm.ts (wraps `routeMessages` and the degraded-mode thunk).
import './slack/rtm.ts';
import {
  exposeDebugGlobals as exposeWebpackDebug,
  installWebpackHooks,
  stats as webpackStats,
} from './slack/webpack.ts';

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
    ok: () => getBridge() !== null,
  },
  {
    name: 'before-slack',
    detail: 'Slack loaded before Slick: injected too late to patch anything',
    ok: () => !(globalThis as any).webpackChunkwebapp && !(globalThis as any).rspackChunkwebapp,
  },
];

function main() {
  const version = typeof __SLICK_VERSION__ === 'string' ? __SLICK_VERSION__ : 'dev';

  for (const check of preconditions) {
    let ok = false;
    try {
      ok = check.ok();
    } catch {}
    if (ok) continue;
    // Failing the first is routine (sign-in pages); the rest mean the loader is broken.
    const log = check.name === 'slack-client' ? console.log : console.error;
    log(`[slick] not starting (${check.name}): ${check.detail}. Slack will load normally.`);
    return;
  }

  const bridge = getBridge();
  if (!bridge) return;

  if (bridge.safeMode) {
    console.warn('[slick] safe mode: plugins will not be loaded');
  }

  // Must be synchronous: the next <script> is Slack's bundle.
  try {
    applyPendingAccountSwitch();
    installWebpackHooks();
    exposeWebpackDebug();
    exposeReactDebug();
    exposeReduxDebug();
    // Must register ahead of Slack's own resize listeners.
    installResizeGate();
    // Wraps window.open before Slack can capture a reference to it.
    installChildWindows();
    onChildWindow(registerDocument);
  } catch (error) {
    console.error('[slick] failed to install interception; Slack will run unmodified:', error);
    return;
  }

  console.log(`[slick] ${version} running before Slack — preconditions passed`);

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

main();
