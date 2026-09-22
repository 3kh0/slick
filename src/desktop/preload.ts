// Slick Desktop Preload
//
// Runs in place of Slack's own preload (patch.ts swaps it) and is the reason
// the rest of Slick can exist: it rebuilds the document so slick.js executes
// before any of Slack's scripts do.
//
// Order matters and is not negotiable:
//   1. eval Slack's original preload, so its contextBridge.exposeInMainWorld
//      calls land before any Slack script looks for them
//   2. fetch and validate a complete replacement without touching the live DOM
//   3. expose SlickBridge
//   4. commit the rebuilt document, CSP meta removed, with
//      slick.js ahead of Slack's own <script> tags
//
// If any of this fails we bail out and let Slack load normally. A broken Slack
// is a far worse outcome than a Slick that did not start.

const { contextBridge, ipcRenderer } = require('electron');

// Every async dependency starts now, in parallel, because all of it blocks the
// document rebuild and therefore Slack's first paint.
const preloadKey = process.argv.find((arg: string) => arg.startsWith('--slick-preload-key='))?.slice(20) ?? '';
const originalPreloadPromise = ipcRenderer.invoke('slick:get-original-preload', preloadKey) as Promise<string | null>;
const originalResponsePromise = fetch(location.href);
const appUrlPromise = ipcRenderer.invoke('slick:get-app-url') as Promise<string>;
const pathsPromise = ipcRenderer.invoke('slick:get-paths') as Promise<Record<string, string>>;
const safeModePromise = ipcRenderer.invoke('slick:get-safe-mode') as Promise<boolean>;

const isClientPage = location.hostname === 'app.slack.com' && /\/client(\/|$)/.test(location.pathname);

const call = (method: string, args: unknown[] = []) => ipcRenderer.invoke('slick:rpc', method, args);

void (async () => {
  try {
    const originalPreload = await originalPreloadPromise;
    if (!originalPreload) throw new Error('Slack preload source is unavailable');
    // biome-ignore lint/security/noGlobalEval: the preload we displaced has to run
    // oxlint-disable-next-line no-eval
    eval(originalPreload);
  } catch (error) {
    console.error('[slick] failed to evaluate Slack preload:', error);
    return;
  }

  if (!isClientPage) return;

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
    // A response policy survives document.write. If it cannot load slick:, the
    // checker inside slick.js can never run, so retain the untouched page.
    if (response.headers.has('content-security-policy')) {
      throw new Error('response contains a Content-Security-Policy header');
    }

    const html = await response.text();
    doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc.head || !doc.body || !doc.querySelector('script')) throw new Error('response is not a usable client page');
  } catch (error) {
    console.error('[slick] could not prepare replacement HTML; leaving the current document intact:', error);
    return;
  }

  let appUrl: string;
  try {
    appUrl = await appUrlPromise;
  } catch {
    appUrl = 'slick://app/slick.js';
  }

  contextBridge.exposeInMainWorld('SlickBridge', {
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

    // The plugin manager supplies this id as a calling convention. The main
    // process independently rejects calls while that plugin is disabled.
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
      write: (key: string, value: string) => call('blobWrite', [namespace, key, value]),
      delete: (key: string) => call('blobDelete', [namespace, key]),
      clear: () => call('blobClear', [namespace]),
    }),

    // contextBridge structure-clones arguments, so only the serializable parts
    // of RequestInit survive the trip.
    fetch: (url: string, init?: RequestInit) => {
      const serial: Record<string, unknown> = {};
      if (init?.method) serial.method = init.method;
      if (typeof init?.body === 'string') serial.body = init.body;
      if (init?.headers) serial.headers = { ...(init.headers as Record<string, string>) };
      return call('fetch', [url, serial]);
    },

    start: () => ipcRenderer.invoke('slick:start'),
  });

  for (const meta of doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')) meta.remove();

  // Slack's scripts have to be re-added in their original order, after ours.
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
    `Reflect.deleteProperty(globalThis,'SlickBridge');console.error('[slick] failed to load ${appUrl}; Slack will run unmodified')`,
  );
  doc.head.appendChild(slick);

  for (const { src, textContent, type } of scripts) {
    const script = doc.createElement('script');
    if (type) script.type = type;
    if (src) script.src = src;
    else if (textContent) script.textContent = textContent;
    doc.head.appendChild(script);
  }

  const previous = document.documentElement?.outerHTML ?? '';
  try {
    document.open();
    document.write(`<!DOCTYPE html>${doc.documentElement.outerHTML}`);
    document.close();
  } catch (error) {
    console.error('[slick] failed to commit replacement HTML; restoring the previous document:', error);
    document.open();
    document.write(`<!DOCTYPE html>${previous}`);
    document.close();
  }
})();
