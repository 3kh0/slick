// Registered via registerPreloadScript; keeps Slack's native preload intact.

import earlyCode from 'slick:early';
import { applyPendingAccountSwitch, PENDING_ACCOUNT_SWITCH_KEY } from '../app/api/accounts.ts';
import { installCookieSignInButton } from './signInButton.ts';

const { contextBridge, ipcRenderer, webFrame } = require('electron');

const accountDiagnostic = (event: string) => {
  try {
    ipcRenderer.send('slick:account-diagnostic', event);
  } catch {}
};
accountDiagnostic('preload.start');

function attachRuntimeScript(appUrl: string, onFail: () => void): void {
  const attach = () => {
    const t = document.head || document.documentElement;
    if (!t) return false;
    const s = document.createElement('script');
    s.id = 'slick-app';
    s.async = true;
    s.src = appUrl;
    s.addEventListener('error', onFail, { once: true });
    t.appendChild(s);
    return true;
  };
  if (attach()) return;
  const mo = new MutationObserver(() => attach() && mo.disconnect());
  mo.observe(document, { childList: true, subtree: true });
}

function runClientPreload() {
  let recovering = false;
  try {
    recovering = sessionStorage.getItem('slick:preload-recovery') === '1';
    sessionStorage.removeItem('slick:preload-recovery');
  } catch {}
  if (recovering) {
    console.warn('[slick] recovering from a failed boot; Slack will load unmodified');
    return;
  }

  const pending = ipcRenderer.sendSync('slick:account-handoff');
  if (pending) {
    try {
      localStorage.setItem(PENDING_ACCOUNT_SWITCH_KEY, JSON.stringify(pending));
      applyPendingAccountSwitch(true);
      accountDiagnostic('preload.handoff-applied');
    } catch {
      accountDiagnostic('preload.failed');
      document.open();
      document.write(
        '<!doctype html><h2>Account switch paused</h2><p>Slack session storage could not be restored. Restart Slick and sign in again.</p>',
      );
      document.close();
      throw new Error('Account handoff could not be applied safely.');
    }
  }

  let boot: Record<string, unknown> | undefined;
  try {
    boot = ipcRenderer.sendSync('slick:get-boot-sync') as Record<string, unknown> | undefined;
  } catch {}

  const safeMode = typeof boot?.safeMode === 'boolean' ? boot.safeMode : undefined;
  const initialSettings =
    safeMode === undefined || typeof boot?.initialSettings !== 'string' ? undefined : boot.initialSettings;
  const paths =
    boot?.paths && typeof boot.paths === 'object' && !Array.isArray(boot.paths)
      ? (boot.paths as Record<string, string>)
      : {};
  const appUrl =
    typeof boot?.appUrl === 'string' && boot.appUrl.startsWith('slick://app/') ? boot.appUrl : 'slick://app/slick.js';

  const call = (method: string, args: unknown[] = []) => ipcRenderer.invoke('slick:rpc', method, args);

  // contextBridge globals are non-configurable, so the API can't be hidden from
  // Slack's scripts. Instead it's a one-shot claim: early.js runs first and
  // takes it; every later caller gets null.
  const api = {
    loader: 'electron' as const,
    loaderVersion: typeof __SLICK_VERSION__ === 'string' ? __SLICK_VERSION__ : 'dev',
    bridgeVersion: 1,
    paths,
    safeMode: safeMode ?? false,
    initialSettings,

    readSettings: () => call('readSettings'),
    writeSettings: (text: string) => call('writeSettings', [text]),
    onSettingsChange(cb: (text: string) => void) {
      const handler = (_: unknown, text: string) => cb(text);
      ipcRenderer.on('slick:settings-changed', handler);
      return () => ipcRenderer.removeListener('slick:settings-changed', handler);
    },

    onOpenSettings(cb: () => void) {
      const handler = () => cb();
      ipcRenderer.on('slick:open-settings', handler);
      return () => ipcRenderer.removeListener('slick:open-settings', handler);
    },

    readUserCss: () => call('readUserCss'),
    writeUserCss: (css: string) => call('writeUserCss', [css]),
    onUserCssChange(cb: (css: string) => void) {
      const handler = (_: unknown, css: string) => cb(css);
      ipcRenderer.on('slick:user-css-changed', handler);
      return () => ipcRenderer.removeListener('slick:user-css-changed', handler);
    },

    getUpdateStatus: () => call('getUpdateStatus'),
    activateUpdate: () => call('activateUpdate'),
    onUpdateStatus(cb: (status: unknown) => void) {
      const handler = (_: unknown, status: unknown) => cb(status);
      ipcRenderer.on('slick:update-status', handler);
      return () => ipcRenderer.removeListener('slick:update-status', handler);
    },

    onHotUpdate(cb: (url: string) => void) {
      const handler = (_: unknown, url: string) => cb(url);
      ipcRenderer.on('slick:hot', handler);
      return () => ipcRenderer.removeListener('slick:hot', handler);
    },

    openFile: (title: string, accept?: string) => call('openFile', [title, accept]),
    openCssEditor: () => call('openCssEditor'),

    evaluateUserPlugin: (code: string) =>
      Promise.resolve(webFrame.executeJavaScript(String(code))).then(() => undefined),

    // The id is a convention, not a trust boundary; main enforces enablement.
    plugin: (id: string) => ({
      call: (method: string, ...args: unknown[]) => ipcRenderer.invoke('slick:plugin-rpc', id, method, args),
      on(event: string, cb: (payload: unknown) => void) {
        const handler = (_: unknown, forId: string, name: string, payload: unknown) => {
          if (forId === id && name === event) cb(payload);
        };
        ipcRenderer.on('slick:plugin-event', handler);
        return () => ipcRenderer.removeListener('slick:plugin-event', handler);
      },
    }),

    blobStore: (namespace: string) => ({
      list: () => call('blobList', [namespace]),
      read: (key: string) => call('blobRead', [namespace, key]),
      readAll: (prefix?: string) => call('blobReadAll', [namespace, prefix ?? '']),
      write: (key: string, value: string) => call('blobWrite', [namespace, key, value]),
      delete: (key: string) => call('blobDelete', [namespace, key]),
      clear: () => call('blobClear', [namespace]),
    }),

    // contextBridge structure-clones, so only serializable RequestInit parts pass.
    fetch: (url: string, init?: RequestInit) => {
      const serial: Record<string, unknown> = {};
      if (init?.method) serial.method = init.method;
      if (typeof init?.body === 'string') serial.body = init.body;
      if (init?.headers) serial.headers = { ...(init.headers as Record<string, string>) };
      return call('fetch', [url, serial]);
    },
  };

  let claimed = false;
  contextBridge.exposeInMainWorld('SlickBridge', {
    claim: () => {
      if (claimed) return null;
      claimed = true;
      return api;
    },
  });

  const failRuntime = () => {
    claimed = true;
    void Promise.resolve(webFrame.executeJavaScript("delete globalThis[Symbol.for('slick.earlyCore')]")).catch(
      () => {},
    );
    console.error(`[slick] failed to load ${appUrl}; Slack will run unmodified`);
  };

  void Promise.resolve(webFrame.executeJavaScript(earlyCode)).then(
    () => {
      attachRuntimeScript(appUrl, failRuntime);
      accountDiagnostic('preload.ready');
    },
    (err: unknown) => {
      claimed = true;
      accountDiagnostic('preload.failed');
      console.error('[slick] failed to execute early loader; Slack will run unmodified:', err);
    },
  );
}

if (location.hostname === 'app.slack.com' && /^\/client(\/|$)/.test(location.pathname)) {
  runClientPreload();
} else if (location.hostname === 'slack.com' || location.hostname.endsWith('.slack.com')) {
  installCookieSignInButton(document, () => ipcRenderer.send('slick:open-cookie-login'));
}
