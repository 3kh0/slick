import { CHANNEL, MAX_PENDING, extensionBrowser, record, validId, validRequest, validResponse } from './rpc.ts';
import { CSS_KEY, DEFAULT_SETTINGS, SETTINGS_KEY } from './storage.ts';
import type { ExtensionBrowser } from './rpc.ts';

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
  void api.runtime.sendMessage({ method: 'tabMode', args: [mode] }).catch(() => {});
  if (mode === 'bypass') return;
  let closed = false;
  const generations = { settings: 0, css: 0 };
  const inflight = new Set<string>();
  const post = (message: unknown) => {
    if (!closed && !bypassed()) window.postMessage(message, location.origin);
  };
  window.addEventListener('message', (event) => {
    const m: unknown = event.data;
    if (
      closed ||
      bypassed() ||
      event.source !== window ||
      event.origin !== location.origin ||
      !record(m) ||
      m.channel !== CHANNEL ||
      m.kind !== 'request' ||
      !validId(m.id)
    )
      return;
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
    api.runtime
      .sendMessage({ method: m.method, args: m.args })
      .then(finish, () => finish({ ok: false, error: 'Extension disconnected' }));
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, event] of [
      [SETTINGS_KEY, 'settings'],
      [CSS_KEY, 'css'],
    ] as const) {
      if (!(key in changes)) continue;
      generations[event]++;
      const value = changes[key].newValue ?? (event === 'settings' ? DEFAULT_SETTINGS : '');
      if (typeof value === 'string' && validResponse({ ok: true, value }))
        post({ channel: CHANNEL, kind: 'change', event, value });
    }
  });
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) closed = true;
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted || closed || bypassed()) return;
    // Reads go through the same bounded background contract, not page data.
    for (const [name, method] of [
      ['settings', 'readSettings'],
      ['css', 'readUserCss'],
    ] as const) {
      const generation = ++generations[name];
      void api.runtime.sendMessage({ method, args: [] }).then(
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
