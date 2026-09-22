// Slick App Entrypoint
//
// Runs as the first script in Slack's rebuilt document. Every precondition
// below is a reason to do nothing at all: because we now run *before* Slack,
// a Slick that half-starts can stop Slack booting entirely, and a Slack that
// does not boot is much worse than a Slack without Slick.

import { registerDocument } from './api/css.ts';
import { installResizeGate } from './api/resize.ts';
import { bootstrap } from './bootstrap.ts';
import { getBridge } from './bridge.ts';
import { SlickPlugin } from '../shared/Plugin.ts';
import { installChildWindows, onChildWindow } from './slack/childWindows.ts';
import { exposeDebugGlobals as exposeReactDebug, patchingReady } from './slack/react.tsx';
// Imported for its side effects: redux.ts wraps createStore and Slack's
// thunk factory at module scope, which has to happen before Slack loads.
import { exposeDebugGlobals as exposeReduxDebug, getStore, reduxReady } from './slack/redux.ts';
// Same for rtm.ts: it wraps `routeMessages` and the degraded-mode thunk so
// plugins can subscribe to websocket events without patching WebSocket.
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
    name: 'csp-removed',
    detail: 'Content Security Policy is still active: the loader did not rebuild the document',
    ok: () => {
      try {
        // oxlint-disable-next-line no-eval
        (0, eval)('1');
        return true;
      } catch {
        return false;
      }
    },
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
    // The first precondition failing is routine (sign-in pages, marketing
    // pages); the rest mean the loader is broken and should be loud.
    const log = check.name === 'slack-client' ? console.log : console.error;
    log(`[slick] not starting (${check.name}): ${check.detail}. Slack will load normally.`);
    return;
  }

  const bridge = getBridge();
  if (!bridge) return;

  if (bridge.safeMode) {
    console.warn('[slick] safe mode: plugins will not be loaded');
  }

  // Interception has to be installed synchronously, before this script returns:
  // the very next <script> in the document is Slack's own bundle.
  try {
    installWebpackHooks();
    exposeWebpackDebug();
    exposeReactDebug();
    exposeReduxDebug();
    // Here rather than in bootstrap for the same reason: the gate only works
    // if it is registered ahead of Slack's own resize listeners. It stays
    // inert until a plugin registers with it.
    installResizeGate();
    // Also here rather than in bootstrap: this wraps window.open, which Slack
    // must not be able to capture a reference to before we patch it.
    installChildWindows();
    onChildWindow(registerDocument);
  } catch (error) {
    console.error('[slick] failed to install interception; Slack will run unmodified:', error);
    return;
  }

  console.log(`[slick] ${version} running before Slack — preconditions passed`);

  // Plugins resolve their base class through this global, so every plugin
  // shares the runtime's SlickPlugin identity (see scripts/lib/plugin.ts).
  (globalThis as any).__slick = { SlickPlugin };

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
