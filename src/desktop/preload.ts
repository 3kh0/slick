// Replaces Slack's preload (patch.ts swaps it) and rebuilds the document so
// slick.js runs before any Slack script. Order is load-bearing:
//   1. blank the document synchronously, before the parser runs Slack's scripts
//   2. eval Slack's original preload so its exposeInMainWorld calls land first
//   3. fetch and validate a replacement document
//   4. expose SlickBridge
//   5. commit it, CSP meta removed, with slick.js ahead of Slack's scripts
//
// Step 1 can't wait for step 3: the parser keeps going during any await, and if
// Slack's bundle loads before slick.js every hook is too late. A failure after
// step 1 leaves a blank window, so those paths reload via `abandon`.

const { contextBridge, ipcRenderer } = require('electron');

// Started in parallel: all of it blocks the rebuild and Slack's first paint.
const preloadKey = process.argv.find((arg: string) => arg.startsWith('--slick-preload-key='))?.slice(20) ?? '';
const originalPreloadPromise = ipcRenderer.invoke('slick:get-original-preload', preloadKey) as Promise<string | null>;
const originalResponsePromise = fetch(location.href);
const appUrlPromise = ipcRenderer.invoke('slick:get-app-url') as Promise<string>;
const pathsPromise = ipcRenderer.invoke('slick:get-paths') as Promise<Record<string, string>>;
const safeModePromise = ipcRenderer.invoke('slick:get-safe-mode') as Promise<boolean>;

const isClientPage = location.hostname === 'app.slack.com' && /\/client(\/|$)/.test(location.pathname);

// Set before a recovery reload; that pass loads stock Slack instead of looping.
const RECOVERY_KEY = 'slick:preload-recovery';
let recovering = false;
try {
  recovering = sessionStorage.getItem(RECOVERY_KEY) === '1';
  sessionStorage.removeItem(RECOVERY_KEY);
} catch {}

const rebuilding = isClientPage && !recovering;
if (recovering) console.warn('[slick] recovering from a failed document rebuild; Slack will load unmodified');

if (rebuilding) {
  document.open();
  document.write('<!DOCTYPE html>');
  document.close();
}

/** The document is already blank, so reload into stock Slack rather than return. */
function abandon(message: string, error: unknown): void {
  console.error(`[slick] ${message}`, error);
  if (!rebuilding) return;
  try {
    sessionStorage.setItem(RECOVERY_KEY, '1');
  } catch {}
  location.reload();
}

const call = (method: string, args: unknown[] = []) => ipcRenderer.invoke('slick:rpc', method, args);

void (async () => {
  try {
    const originalPreload = await originalPreloadPromise;
    if (!originalPreload) throw new Error('Slack preload source is unavailable');
    // biome-ignore lint/security/noGlobalEval: the preload we displaced has to run
    // oxlint-disable-next-line no-eval
    eval(originalPreload);
  } catch (error) {
    return abandon('failed to evaluate Slack preload:', error);
  }

  if (!rebuilding) return;

  let doc: Document;
  try {
    const response = await originalResponsePromise;
    const responseUrl = new URL(response.url);
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (
      responseUrl.origin !== location.origin ||
      !/\/client(\/|$)/.test(responseUrl.pathname) ||
      !/^text\/html(?:;|$)/i.test(contentType)
    ) {
      throw new Error(`unexpected response (${response.url}, ${contentType || 'no content type'})`);
    }
    // A CSP header survives document.write and could block slick:.
    if (response.headers.has('content-security-policy')) {
      throw new Error('response contains a Content-Security-Policy header');
    }

    const html = await response.text();
    doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc.head || !doc.body || !doc.querySelector('script')) throw new Error('response is not a usable client page');
  } catch (error) {
    return abandon('could not prepare replacement HTML:', error);
  }

  let appUrl: string;
  try {
    appUrl = await appUrlPromise;
  } catch {
    appUrl = 'slick://app/slick.js';
  }

  // contextBridge globals are non-configurable, so the API can't be hidden from
  // Slack's scripts. Instead it's a one-shot claim: slick.js runs first and
  // takes it; every later caller gets null.
  const api = {
    loader: 'electron' as const,
    loaderVersion: typeof __SLICK_VERSION__ === 'string' ? __SLICK_VERSION__ : 'dev',
    bridgeVersion: 1,
    paths: await pathsPromise.catch(() => ({})),
    safeMode: await safeModePromise.catch(() => false),

    readSettings: () => call('readSettings'),
    writeSettings: (text: string) => call('writeSettings', [text]),
    onSettingsChange(cb: (text: string) => void) {
      const handler = (_: unknown, text: string) => cb(text);
      ipcRenderer.on('slick:settings-changed', handler);
      return () => ipcRenderer.removeListener('slick:settings-changed', handler);
    },

    readUserCss: () => call('readUserCss'),
    writeUserCss: (css: string) => call('writeUserCss', [css]),
    onUserCssChange(cb: (css: string) => void) {
      const handler = (_: unknown, css: string) => cb(css);
      ipcRenderer.on('slick:user-css-changed', handler);
      return () => ipcRenderer.removeListener('slick:user-css-changed', handler);
    },

    openFile: (title: string, accept?: string) => call('openFile', [title, accept]),
    openCssEditor: () => call('openCssEditor'),

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

  for (const meta of doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')) meta.remove();

  const scripts = Array.from(doc.querySelectorAll('script')).map((script) => ({
    src: (script as HTMLScriptElement).src,
    textContent: script.textContent,
    type: script.getAttribute('type'),
  }));
  for (const script of doc.querySelectorAll('script')) script.remove();

  const slick = doc.createElement('script');
  slick.id = 'slick-app';
  slick.src = appUrl;
  slick.setAttribute(
    'onerror',
    `globalThis.SlickBridge&&globalThis.SlickBridge.claim();console.error('[slick] failed to load ${appUrl}; Slack will run unmodified')`,
  );
  doc.head.appendChild(slick);

  for (const { src, textContent, type } of scripts) {
    const script = doc.createElement('script');
    if (type) script.type = type;
    if (src) script.src = src;
    else if (textContent) script.textContent = textContent;
    doc.head.appendChild(script);
  }

  try {
    document.open();
    document.write(`<!DOCTYPE html>${doc.documentElement.outerHTML}`);
    document.close();
  } catch (error) {
    abandon('failed to commit replacement HTML:', error);
  }
})();
