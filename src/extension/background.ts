import { validMethodResponse, validRequest } from './rpc.ts';
import type { ExtensionBrowser, Response, Sender } from './rpc.ts';
import { createMainHost, type BackgroundPlugin } from './mainHost.ts';
import { SETTINGS_KEY, createStorage } from './storage.ts';
import { indexedDbBackend, type BlobBackend } from './blobs.ts';
import { createAccountService, AccountError, type AccountBrowser } from './accounts.ts';

export const TOOLBAR_ICONS = { black: 'icons/black.svg', white: 'icons/white.svg' } as const;

/** The chosen toolbar mark, or null to follow the Firefox theme (manifest theme_icons). */
export function toolbarIconPath(settings: unknown, chromium = false): string | null {
  try {
    const choice: unknown = JSON.parse(String(settings)).toolbarIcon;
    return choice === 'black' || choice === 'white' ? (chromium ? `icons/${choice}.png` : TOOLBAR_ICONS[choice]) : null;
  } catch {
    return null;
  }
}

function ownedUi(sender: Sender, extensionRoot: string): boolean {
  try {
    const url = new URL(sender.url ?? '');
    const root = new URL(extensionRoot);
    return (
      ['moz-extension:', 'chrome-extension:'].includes(root.protocol) &&
      url.protocol === root.protocol &&
      url.host === root.host
    );
  } catch {
    return false;
  }
}

export function allowedSender(sender: Sender, id: string, extensionRoot: string): boolean {
  if (sender.id !== id || !sender.url || (sender.frameId !== undefined && sender.frameId !== 0)) return false;
  try {
    const url = new URL(sender.url);
    if (ownedUi(sender, extensionRoot)) return true;
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
const parse = (text: unknown) => {
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
};

export function createBackground(
  api: ExtensionBrowser,
  plugins: BackgroundPlugin[] = [],
  blobs?: BlobBackend,
  accountService?: ReturnType<typeof createAccountService>,
) {
  const storage = createStorage(api.storage.local, blobs ?? indexedDbBackend());
  const host = createMainHost(api.storage.local, api.declarativeNetRequest, plugins);
  const accounts = accountService ?? createAccountService(api as AccountBrowser);
  if ((api as AccountBrowser).cookies) void accounts.recover().catch(() => {});
  let lastAccountOpen = 0;
  const exemptionsKey = 'slick:extension:exempt-tabs';
  const exemptions = new Set<number>();
  // Settings arrive before any rules, so a suspended page's rules are replaced, not doubled.
  const hostReady = host
    .reset()
    .then(async () => {
      const stored = (await api.storage.session?.get(exemptionsKey))?.[exemptionsKey];
      if (Array.isArray(stored))
        for (const tabId of stored) {
          if (Number.isInteger(tabId) && tabId >= 0) {
            exemptions.add(tabId);
            await host.setExempt(tabId, true);
          }
        }
    })
    .then(() => storage.dispatch({ method: 'readSettings', args: [] }))
    .then((r) => (r.ok ? host.update(parse(r.value)) : undefined));
  let modesReady: Promise<unknown> = hostReady;
  const setMode = (tabId: number, exempt: boolean) => {
    const next = modesReady.then(async () => {
      if (exempt) exemptions.add(tabId);
      else exemptions.delete(tabId);
      await api.storage.session?.set({ [exemptionsKey]: [...exemptions] });
      await host.setExempt(tabId, exempt);
    });
    modesReady = next.catch(() => {});
    return next;
  };
  api.tabs.onRemoved?.addListener((tabId) => {
    void setMode(tabId, false);
  });
  // setIcon({ path: null }) restores the manifest icon, theme_icons included.
  const chromium = api.runtime.getURL('').startsWith('chrome-extension:');
  const applyIcon = (settings: unknown) =>
    api.action
      ?.setIcon({ path: toolbarIconPath(settings, chromium) ?? (chromium ? 'icons/32.png' : null) })
      .catch(() => {});
  void storage.dispatch({ method: 'readSettings', args: [] }).then((r) => {
    if (r.ok) void applyIcon(r.value);
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(SETTINGS_KEY in changes)) return;
    applyIcon(changes[SETTINGS_KEY].newValue);
    void hostReady.then(() => host.update(parse(changes[SETTINGS_KEY].newValue)));
  });
  return async (message: unknown, sender: Sender): Promise<Response> => {
    if (!allowedSender(sender, api.runtime.id, api.runtime.getURL('')) || !validRequest(message))
      return { ok: false, error: 'Request denied' };
    if (message.method.startsWith('account.')) {
      const ui = ownedUi(sender, api.runtime.getURL('')) && new URL(sender.url!).pathname === '/accounts.html';
      const publicMethod = message.method === 'account.list' || message.method === 'account.open';
      if ((!publicMethod && !ui) || sender.incognito || sender.tab?.incognito)
        return { ok: false, error: 'Use the account manager in a normal browser window' };
      try {
        const config = await storage.dispatch({ method: 'readSettings', args: [] });
        const parsed = config.ok ? parse(config.value) : null;
        const enabled = parsed?.enabled !== false && parsed?.plugins?.AccountSwitcher?.enabled === true;
        if (message.method === 'account.status')
          return { ok: true, value: JSON.stringify({ ...(await accounts.status()), enabled }) };
        if (message.method === 'account.list')
          return { ok: true, value: JSON.stringify(enabled ? await accounts.list() : []) };
        if (!enabled && message.method !== 'account.forget')
          return { ok: false, error: 'Enable Account Switcher in Slick settings first' };
        if (message.method === 'account.open') {
          if (Date.now() - lastAccountOpen < 2_000) return { ok: true, value: true };
          lastAccountOpen = Date.now();
          await api.tabs.create({
            url: api.runtime.getURL('accounts.html') + (message.args[0] ? '#' + message.args[0] : ''),
          });
          return { ok: true, value: true };
        }
        if (message.method === 'account.capture')
          return { ok: true, value: JSON.stringify(await accounts.capture(message.args[0], message.args[1])) };
        if (message.method === 'account.forget') return { ok: true, value: await accounts.forget(message.args[0]) };
        if (message.method === 'account.switch')
          return { ok: true, value: await accounts.switchTo(message.args[0], message.args[1]) };
        if (message.method === 'account.add') return { ok: true, value: await accounts.add(message.args[0]) };
        if (message.method === 'account.recover') return { ok: true, value: await accounts.recover() };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof AccountError
              ? error.message.slice(0, 256)
              : 'Account action failed. Reopen the account manager and try again.',
        };
      }
      return { ok: false, error: 'Request denied' };
    }
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
    if (message.method === 'tabMode') {
      const tabId = sender.tab?.id;
      if (tabId === undefined || ownedUi(sender, api.runtime.getURL(''))) return { ok: false, error: 'Request denied' };
      await setMode(tabId, message.args[0] !== 'normal');
      return { ok: true, value: true };
    }
    if (message.method === 'plugin.call') {
      const [id, method, args] = message.args;
      try {
        await hostReady;
        const decoded: unknown = JSON.parse(args);
        if (!Array.isArray(decoded)) throw new Error('bad args');
        const value = JSON.stringify((await host.call(id, method, decoded)) ?? null);
        return validMethodResponse('plugin.call', { ok: true, value })
          ? { ok: true, value }
          : { ok: false, error: 'Plugin response too large' };
      } catch (error) {
        return { ok: false, error: String((error as Error)?.message ?? error).slice(0, 200) };
      }
    }
    return storage.dispatch(message);
  };
}
