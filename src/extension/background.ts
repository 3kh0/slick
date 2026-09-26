import { extensionBrowser, validRequest } from './rpc.ts';
import type { ExtensionBrowser, Response, Sender } from './rpc.ts';
import { SETTINGS_KEY, createStorage } from './storage.ts';

export const TOOLBAR_ICONS = { black: 'icons/black.svg', white: 'icons/white.svg' } as const;

/** The chosen toolbar mark, or null to follow the Firefox theme (manifest theme_icons). */
export function toolbarIconPath(settings: unknown): string | null {
  try {
    const choice: unknown = JSON.parse(String(settings)).toolbarIcon;
    return choice === 'black' || choice === 'white' ? TOOLBAR_ICONS[choice] : null;
  } catch {
    return null;
  }
}

function ownedUi(sender: Sender, extensionRoot: string): boolean {
  try {
    const url = new URL(sender.url ?? '');
    const root = new URL(extensionRoot);
    return root.protocol === 'moz-extension:' && url.protocol === root.protocol && url.host === root.host;
  } catch {
    return false;
  }
}

export function allowedSender(sender: Sender, id: string, extensionRoot: string): boolean {
  if (sender.id !== id || !sender.url || (sender.frameId !== undefined && sender.frameId !== 0)) return false;
  try {
    const url = new URL(sender.url);
    const root = new URL(extensionRoot);
    if (url.protocol === root.protocol && url.host === root.host && root.protocol === 'moz-extension:') return true;
    return (
      sender.frameId === 0 &&
      sender.tab?.id !== undefined &&
      url.protocol === 'https:' &&
      url.host === 'app.slack.com' &&
      /^\/client(\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}
export function createBackground(api: ExtensionBrowser) {
  const storage = createStorage(api.storage.local);
  // setIcon({ path: null }) restores the manifest icon, theme_icons included.
  const applyIcon = (settings: unknown) => api.action?.setIcon({ path: toolbarIconPath(settings) }).catch(() => {});
  void storage.dispatch({ method: 'readSettings', args: [] }).then((r) => {
    if (r.ok) void applyIcon(r.value);
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && SETTINGS_KEY in changes) applyIcon(changes[SETTINGS_KEY].newValue);
  });
  return async (message: unknown, sender: Sender): Promise<Response> => {
    if (!allowedSender(sender, api.runtime.id, api.runtime.getURL('')) || !validRequest(message))
      return { ok: false, error: 'Request denied' };
    if (message.method === 'openCssEditor') {
      // Page messages are forgeable; only extension-owned UI may create tabs.
      if (!ownedUi(sender, api.runtime.getURL('')))
        return { ok: false, error: 'Use the Slick toolbar to open options' };
      try {
        await api.tabs.create({ url: api.runtime.getURL('options.html') });
        return { ok: true, value: true };
      } catch {
        return { ok: false, error: 'Could not open options' };
      }
    }
    return storage.dispatch(message);
  };
}
const api = extensionBrowser();
if (api) api.runtime.onMessage.addListener(createBackground(api));
