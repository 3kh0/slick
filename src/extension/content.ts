import {
  CHANNEL,
  MAX_PENDING,
  MAX_TEXT,
  extensionBrowser,
  record,
  validId,
  validRequest,
  validResponse,
} from './rpc.ts';
import { CSS_KEY, DEFAULT_SETTINGS, SETTINGS_KEY, THEME_CSS_KEY } from './storage.ts';
import type { ExtensionBrowser, Request } from './rpc.ts';

const EXEMPT_KEY = 'slick:firefox:exempt';

export function installRelay(api: ExtensionBrowser, window: Window) {
  const location = window.location;
  if (
    window.top !== window ||
    location.origin !== 'https://app.slack.com' ||
    !/^\/client(\/|$)/.test(location.pathname)
  )
    return;
  // sessionStorage and the page namespace are untrusted, not authorization.
  // Bypass is a user-controlled kill switch; fail closed if it cannot be read.
  const bypassed = () => {
    try {
      return window.sessionStorage.getItem('slick:firefox:bypass') === '1';
    } catch {
      return true;
    }
  };
  let mode = 'normal';
  try {
    if (window.sessionStorage.getItem('slick:firefox:safe-mode') === '1') mode = 'safe';
  } catch {}
  if (bypassed()) mode = 'bypass';
  const send = (message: Request): Promise<unknown> => {
    try {
      return api.runtime.sendMessage(message);
    } catch {
      return Promise.reject(new Error('Extension disconnected'));
    }
  };
  let wasExempt = false;
  try {
    wasExempt = window.sessionStorage.getItem(EXEMPT_KEY) === '1';
  } catch {
    wasExempt = true;
  }
  if (mode !== 'normal') {
    try {
      window.sessionStorage.setItem(EXEMPT_KEY, '1');
    } catch {}
    void send({ method: 'tabMode', args: [mode] }).catch(() => {});
  } else if (wasExempt) {
    void send({ method: 'tabMode', args: ['normal'] }).then(
      (response) => {
        if (validResponse(response) && response.ok) {
          try {
            window.sessionStorage.removeItem(EXEMPT_KEY);
          } catch {}
        }
      },
      () => {},
    );
  }
  if (mode === 'bypass') return;
  let closed = false;
  let port: MessagePort | null = null;
  const generations = { settings: 0, css: 0 };
  const bootPrefetch = { settings: true, css: true };
  const inflight = new Set<string>();
  const prePaintCleanups = new Map<'css' | 'settings', (() => void)[]>();
  const trackPrePaint = (slot: 'css' | 'settings', cleanup: () => void) => {
    const list = prePaintCleanups.get(slot) ?? [];
    list.push(cleanup);
    prePaintCleanups.set(slot, list);
  };
  const clearPrePaint = (slot?: 'css' | 'settings') => {
    for (const key of slot ? [slot] : (['css', 'settings'] as const)) {
      const list = prePaintCleanups.get(key);
      if (!list) continue;
      while (list.length) list.pop()!();
      prePaintCleanups.delete(key);
    }
  };
  const readPrefetch = (): Promise<Record<string, unknown> | null> | null => {
    try {
      const local = api.storage?.local;
      if (typeof local?.get !== 'function') return null;
      return Promise.resolve(local.get([SETTINGS_KEY, CSS_KEY, THEME_CSS_KEY])).then(
        (items) => (record(items) ? items : null),
        () => null,
      );
    } catch {
      return null;
    }
  };
  const prefetch = readPrefetch();
  if (mode === 'normal' && prefetch && window.document && typeof window.document.createElement === 'function') {
    const doc = window.document;
    const MO =
      (window as Window & { MutationObserver?: typeof MutationObserver }).MutationObserver ??
      globalThis.MutationObserver;
    const attachStyle = (slot: 'css' | 'settings', key: string, cssText: string) => {
      if (closed || bypassed() || generations[slot] !== 0 || !cssText) return;
      const mount = () => {
        if (closed || bypassed() || generations[slot] !== 0) return true;
        const target = doc.head || doc.documentElement;
        if (!target) return false;
        if (!doc.querySelector(`style[data-slick-style="${key}"]`)) {
          const el = doc.createElement('style');
          el.dataset.slickStyle = key;
          el.textContent = cssText;
          target.appendChild(el);
        }
        return true;
      };
      if (!mount() && typeof MO === 'function') {
        const mo = new MO(() => {
          if (mount()) mo.disconnect();
        });
        mo.observe(doc, { childList: true, subtree: true });
        trackPrePaint(slot, () => mo.disconnect());
      }
    };
    void prefetch.then((items) => {
      if (!items || closed || bypassed()) return;
      const userCss = items[CSS_KEY];
      if (typeof userCss === 'string' && userCss && userCss.length <= MAX_TEXT && generations.css === 0)
        attachStyle('css', 'user', userCss);
      const rawTheme = items[THEME_CSS_KEY];
      if (
        record(rawTheme) &&
        typeof rawTheme.css === 'string' &&
        rawTheme.css &&
        rawTheme.css.length <= MAX_TEXT &&
        generations.settings === 0
      ) {
        const themeCss = rawTheme.css;
        const themeMode = rawTheme.mode === 'dark' || rawTheme.mode === 'light' ? rawTheme.mode : null;
        if (!themeMode || doc.body?.classList.contains(`sk-client-theme--${themeMode}`)) {
          attachStyle('settings', 'theme', themeCss);
        } else {
          const waitBody = () => {
            if (closed || bypassed() || generations.settings !== 0) return true;
            if (!doc.body) return false;
            if (doc.body.classList.contains(`sk-client-theme--${themeMode}`)) {
              attachStyle('settings', 'theme', themeCss);
              return true;
            }
            if (typeof MO === 'function') {
              let timer: ReturnType<typeof setTimeout>;
              const stop = () => {
                clearTimeout(timer);
                bo.disconnect();
              };
              const bo = new MO(() => {
                if (closed || bypassed() || generations.settings !== 0) {
                  stop();
                  return;
                }
                if (doc.body?.classList.contains(`sk-client-theme--${themeMode}`)) {
                  attachStyle('settings', 'theme', themeCss);
                  stop();
                }
              });
              bo.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
              timer = setTimeout(stop, 10000);
              trackPrePaint('settings', stop);
            }
            return true;
          };
          if (!waitBody() && typeof MO === 'function') {
            const mo = new MO(() => {
              if (waitBody()) mo.disconnect();
            });
            mo.observe(doc, { childList: true, subtree: true });
            trackPrePaint('settings', () => mo.disconnect());
          }
        }
      }
    });
  }
  const post = (message: unknown) => {
    if (closed || bypassed()) return;
    if (port) port.postMessage(message);
    else window.postMessage(message, location.origin);
  };
  const handleRequest = (m: unknown) => {
    if (closed || bypassed() || !record(m) || m.channel !== CHANNEL || m.kind !== 'request' || !validId(m.id)) return;
    const id = m.id;
    if (!validRequest(m) || inflight.has(id) || inflight.size >= MAX_PENDING) return;
    inflight.add(id);
    const timer = setTimeout(() => finish({ ok: false, error: 'Extension request timed out' }), 9000);
    function finish(response: unknown) {
      if (!inflight.delete(id)) return;
      clearTimeout(timer);
      post({
        channel: CHANNEL,
        kind: 'response',
        id,
        response: validResponse(response) ? response : { ok: false, error: 'Invalid extension response' },
      });
    }
    if (m.method === 'writeSettings' || m.method === 'compareAndSwapSettings') {
      bootPrefetch.settings = false;
      generations.settings++;
      clearPrePaint('settings');
    } else if (m.method === 'writeUserCss') {
      bootPrefetch.css = false;
      generations.css++;
      clearPrePaint('css');
    } else if ((m.method === 'readSettings' || m.method === 'readUserCss') && prefetch) {
      const slot = m.method === 'readSettings' ? 'settings' : 'css';
      if (bootPrefetch[slot]) {
        bootPrefetch[slot] = false;
        const gen = generations[slot];
        void prefetch.then((items) => {
          if (closed || bypassed()) {
            finish({ ok: false, error: 'Extension disconnected' });
            return;
          }
          if (items !== null && gen === generations[slot]) {
            const key = slot === 'settings' ? SETTINGS_KEY : CSS_KEY;
            const fallback = slot === 'settings' ? DEFAULT_SETTINGS : '';
            const raw = items[key];
            const value = typeof raw === 'string' && validResponse({ ok: true, value: raw }) ? raw : fallback;
            finish({ ok: true, value });
            return;
          }
          send({ method: m.method, args: m.args }).then(finish, () =>
            finish({ ok: false, error: 'Extension disconnected' }),
          );
        });
        return;
      }
    }
    send({ method: m.method, args: m.args }).then(finish, () => finish({ ok: false, error: 'Extension disconnected' }));
  };
  window.addEventListener('message', (event) => {
    const m: unknown = event.data;
    if (
      closed ||
      bypassed() ||
      event.source !== window ||
      event.origin !== location.origin ||
      !record(m) ||
      m.channel !== CHANNEL
    )
      return;
    // Accept only the bridge's single startup port; page code cannot replace it later.
    if (m.kind === 'port') {
      if (!port && event.ports?.[0]) {
        port = event.ports[0];
        port.addEventListener('message', (ev: MessageEvent) => handleRequest(ev.data));
        port.start();
      }
      return;
    }
    if (!port) handleRequest(m);
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, event] of [
      [SETTINGS_KEY, 'settings'],
      [CSS_KEY, 'css'],
    ] as const) {
      if (!(key in changes)) continue;
      bootPrefetch[event] = false;
      clearPrePaint(event);
      generations[event]++;
      const value = changes[key].newValue ?? (event === 'settings' ? DEFAULT_SETTINGS : '');
      if (typeof value === 'string' && validResponse({ ok: true, value }))
        post({ channel: CHANNEL, kind: 'change', event, value });
    }
  });
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    closed = true;
    clearPrePaint();
    port?.close();
    port = null;
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted || closed || bypassed()) return;
    bootPrefetch.settings = false;
    bootPrefetch.css = false;
    clearPrePaint();
    // Reads go through the same bounded background contract, not page data.
    for (const [name, method] of [
      ['settings', 'readSettings'],
      ['css', 'readUserCss'],
    ] as const) {
      const generation = ++generations[name];
      void send({ method, args: [] }).then(
        (response) => {
          if (
            generation !== generations[name] ||
            !validResponse(response) ||
            !response.ok ||
            typeof response.value !== 'string'
          )
            return;
          post({ channel: CHANNEL, kind: 'change', event: name, value: response.value });
        },
        () => {},
      );
    }
  });
}
const api = extensionBrowser();
if (api && typeof window !== 'undefined') installRelay(api, window);
