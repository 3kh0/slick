import { extensionBrowser, validRequest } from './rpc.ts';
import type { ExtensionBrowser, Response, Sender } from './rpc.ts';
import { createStorage } from './storage.ts';

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
