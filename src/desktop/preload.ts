// Slick Desktop Preload
//
// Runs in place of Slack's own preload (patch.ts swaps it) and is the reason
// the rest of Slick can exist: it rebuilds the document so slick.js executes
// before any of Slack's scripts do.
//
// Order matters and is not negotiable:
//   1. blank the document synchronously, before Slack's markup can be parsed
//   2. eval Slack's original preload, so its contextBridge.exposeInMainWorld
//      calls land before any Slack script looks for them
//   3. expose SlickBridge
//   4. rebuild the document from a fresh fetch, CSP meta removed, with
//      slick.js ahead of Slack's own <script> tags
//
// If any of this fails we bail out and let Slack load normally. A broken Slack
// is a far worse outcome than a Slick that did not start.

const { contextBridge, ipcRenderer } = require('electron');

// Every async dependency starts now, in parallel, because all of it blocks the
// document rebuild and therefore Slack's first paint.
const originalPreloadPromise = ipcRenderer.invoke('slick:get-original-preload') as Promise<string | null>;
const originalHtmlPromise = fetch(location.href).then((response) => response.text());
const appUrlPromise = ipcRenderer.invoke('slick:get-app-url') as Promise<string>;
const pathsPromise = ipcRenderer.invoke('slick:get-paths') as Promise<Record<string, string>>;
const safeModePromise = ipcRenderer.invoke('slick:get-safe-mode') as Promise<boolean>;

const isClientPage = location.hostname === 'app.slack.com' && /\/client(\/|$)/.test(location.pathname);

// Synchronous, and before the `await` below, so Slack's markup never renders a
// frame we are about to throw away.
if (isClientPage) {
  document.open();
  document.write('<!DOCTYPE html>');
  document.close();
}

const call = (method: string, args: unknown[] = []) => ipcRenderer.invoke('slick:rpc', method, args);

void (async () => {
  try {
    const originalPreload = await originalPreloadPromise;
    if (originalPreload) {
      // biome-ignore lint/security/noGlobalEval: the preload we displaced has to run
      // oxlint-disable-next-line no-eval
      eval(originalPreload);
    }
  } catch (error) {
    console.error('[slick] failed to evaluate Slack preload:', error);
  }

  if (!isClientPage) return;

  let html: string;
  try {
    html = await originalHtmlPromise;
  } catch (error) {
    console.error('[slick] could not refetch page HTML, leaving Slack alone:', error);
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

    // Per-plugin main-process RPC. The renderer never supplies the plugin id;
    // the plugin manager binds it, so a plugin cannot address another's methods.
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

    start: () => ipcRenderer.invoke('slick:start'),
  });

  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.remove();

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
  slick.setAttribute('onerror', `console.error('[slick] failed to load ${appUrl}; Slack will run unmodified')`);
  doc.head.appendChild(slick);

  for (const { src, textContent, type } of scripts) {
    const script = doc.createElement('script');
    if (type) script.type = type;
    if (src) script.src = src;
    else if (textContent) script.textContent = textContent;
    doc.head.appendChild(script);
  }

  document.open();
  document.write(`<!DOCTYPE html>${doc.documentElement.outerHTML}`);
  document.close();
})();
