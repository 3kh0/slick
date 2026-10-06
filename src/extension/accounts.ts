import type { LocalConfigTeam } from '../app/slack/localConfig.ts';
import type { AccountSummary } from '../plugins/AccountSwitcher/types.ts';
import type { ExtensionBrowser } from './rpc.ts';
import { encryptedAccountVault, type AccountVault } from './accountVault.ts';
import { serialQueue } from '../shared/queue.ts';

export const ACCOUNT_PERMISSIONS = {
  permissions: ['cookies', 'browsingData'],
  origins: ['https://*.slack.com/*'],
};
export const ACCOUNT_BARRIER_ID = 1_000_000;
const SLACK = 'https://app.slack.com';
const SESSION_NAMES = ['d', 'd-s', 'uc'];
const CLIENT = /^https:\/\/app\.slack\.com\/client(?:\/|$)/;
const ID = /^[A-Z][A-Z0-9]{5,63}$/;

export class AccountError extends Error {}
class RejectedSession extends AccountError {
  readonly retryDOnly: boolean;
  constructor(retryDOnly = false) {
    super('Slack rejected this saved session. Sign in to that account again.');
    this.retryDOnly = retryDOnly;
  }
}
export type AccountTab = {
  id?: number;
  url?: string;
  incognito?: boolean;
  cookieStoreId?: string;
  lastAccessed?: number;
  status?: string;
};
export type AccountCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  expirationDate?: number;
  hostOnly?: boolean;
  storeId?: string;
  partitionKey?: unknown;
  firstPartyDomain?: string;
};
export type AccountBrowser = ExtensionBrowser & {
  permissions: {
    contains(value: typeof ACCOUNT_PERMISSIONS): Promise<boolean>;
    request(value: typeof ACCOUNT_PERMISSIONS): Promise<boolean>;
  };
  cookies: {
    getAll(value: { domain: string }): Promise<AccountCookie[]>;
    set(
      value: Omit<AccountCookie, 'hostOnly' | 'partitionKey' | 'firstPartyDomain' | 'domain'> & {
        url: string;
        domain?: string;
      },
    ): Promise<unknown>;
    remove(value: { url: string; name: string; storeId?: string }): Promise<unknown>;
  };
  tabs: ExtensionBrowser['tabs'] & {
    create(options: { url: string; active?: boolean }): Promise<AccountTab>;
    query(options: { url?: string[] }): Promise<AccountTab[]>;
    get(id: number): Promise<AccountTab>;
    update(id: number, value: { url: string; active?: boolean }): Promise<AccountTab>;
  };
  scripting: {
    executeScript<T>(value: {
      target: { tabId: number };
      func: (...args: any[]) => T;
      args?: unknown[];
    }): Promise<{ result?: Awaited<T> }[]>;
  };
  browsingData: {
    remove(
      options: { origins?: string[]; hostnames?: string[]; cookieStoreId?: string },
      types: { localStorage: true; indexedDB: true; serviceWorkers?: true; cacheStorage?: true },
    ): Promise<void>;
  };
};
type Context = { teamId: string; team: LocalConfigTeam; config: string };
type SavedAccount = AccountSummary & { team: LocalConfigTeam; cookies: AccountCookie[] };
type Journal = {
  tabs: { id: number; url: string }[];
  cookies: AccountCookie[];
  config: string | null;
  committed?: string;
};
export type AccountState = { accounts: SavedAccount[]; journal?: Journal };

// Self-contained: executeScript serializes functions into the isolated world.
export function readAccountContext(): Context | null {
  if (location.origin !== 'https://app.slack.com') return null;
  const config = localStorage.getItem('localConfig_v2');
  if (!config || config.length > 1_000_000) return null;
  try {
    const parsed = JSON.parse(config);
    const teamId = /^\/client\/([A-Z][A-Z0-9]{5,63})(?:\/|$)/.exec(location.pathname)?.[1] ?? parsed.lastActiveTeamId;
    const team = parsed.teams?.[teamId];
    if (
      typeof teamId !== 'string' ||
      !/^[A-Z][A-Z0-9]{5,63}$/.test(teamId) ||
      typeof team?.user_id !== 'string' ||
      !/^[A-Z][A-Z0-9]{5,63}$/.test(team.user_id) ||
      typeof team.token !== 'string' ||
      !team.token ||
      team.token.length > 65_536
    )
      return null;
    return { teamId, team, config };
  } catch {
    return null;
  }
}
export async function writeAccountContext(config: string | null): Promise<void> {
  if (location.origin !== 'https://app.slack.com' || location.pathname !== '/robots.txt')
    throw new Error('Wrong staging page');
  localStorage.clear();
  sessionStorage.clear();
  if (config !== null) localStorage.setItem('localConfig_v2', config);
  for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  // Firefox cannot scope browsingData cacheStorage deletion by hostname.
  for (const name of await caches.keys()) await caches.delete(name);
}
const isNormal = (tab: AccountTab) => !tab.incognito && (!tab.cookieStoreId || tab.cookieStoreId === 'firefox-default');
function normalTab(tab: AccountTab) {
  if (!isNormal(tab))
    throw new AccountError(
      'Account switching supports normal browser tabs. Private windows and Firefox containers keep separate sessions.',
    );
}
function publicSummary(account: SavedAccount): AccountSummary {
  return {
    userId: account.userId,
    teamId: account.teamId,
    enterpriseId: account.enterpriseId,
    updatedAt: account.updatedAt,
    label: account.label,
  };
}
const cookieUrl = (cookie: AccountCookie) => `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
const signature = (cookies: AccountCookie[]) =>
  JSON.stringify(
    cookies
      .toSorted((a, b) => `${a.domain}:${a.path}:${a.name}`.localeCompare(`${b.domain}:${b.path}:${b.name}`))
      .map(({ name, value, domain, path }) => ({ name, value, domain, path })),
  );

export function createAccountService(
  api: AccountBrowser,
  vault: AccountVault<AccountState> = encryptedAccountVault(() => ({ accounts: [] })),
  fetcher: typeof fetch = fetch,
) {
  const enqueue = serialQueue();
  let busy = false;
  const serial = <T>(work: () => Promise<T>): Promise<T> =>
    enqueue(async () => {
      busy = true;
      try {
        return await work();
      } finally {
        busy = false;
      }
    });
  const permissions = () => api.permissions?.contains(ACCOUNT_PERMISSIONS) ?? Promise.resolve(false);
  async function requirePermissions() {
    if (!(await permissions()))
      throw new AccountError('Enable account switching in the account manager to grant Slack session access.');
  }
  async function clients() {
    const tabs = await api.tabs.query({});
    return tabs.filter(
      (tab) => isNormal(tab) && (tab.url === paused() || /^https:\/\/(?:[^/]+\.)?slack\.com\//.test(tab.url ?? '')),
    );
  }
  async function cookies() {
    const all = await api.cookies.getAll({ domain: 'slack.com' });
    return all
      .filter(
        (c) =>
          SESSION_NAMES.includes(c.name) &&
          /(^|\.)slack\.com$/.test(c.domain) &&
          !c.partitionKey &&
          !c.firstPartyDomain,
      )
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expirationDate: c.expirationDate,
        hostOnly: c.hostOnly,
        storeId: c.storeId,
      }));
  }
  async function installCookies(next: AccountCookie[]) {
    for (const cookie of await cookies())
      await api.cookies.remove({ url: cookieUrl(cookie), name: cookie.name, storeId: cookie.storeId });
    for (const cookie of next) {
      const { hostOnly, domain, ...rest } = cookie;
      const installed = await api.cookies.set({
        ...rest,
        url: cookieUrl(cookie),
        ...(hostOnly ? {} : { domain }),
      } as Parameters<AccountBrowser['cookies']['set']>[0]);
      if (!installed) throw new AccountError('Could not restore Slack session cookies.');
    }
  }
  async function context(tabId: number) {
    const tab = await api.tabs.get(tabId);
    normalTab(tab);
    if (!CLIENT.test(tab.url ?? '')) throw new AccountError('Choose an open Slack client tab.');
    return (await api.scripting.executeScript({ target: { tabId }, func: readAccountContext }))[0]?.result ?? null;
  }
  async function verify(team: LocalConfigTeam, userId: string) {
    let host: URL;
    try {
      host = new URL(String(team.url));
    } catch {
      throw new AccountError('The workspace address is missing. Reopen Slack and save this account again.');
    }
    if (
      host.protocol !== 'https:' ||
      !host.hostname.endsWith('.slack.com') ||
      host.username ||
      host.password ||
      host.port
    )
      throw new AccountError('The saved workspace address is invalid.');
    try {
      const response = await fetcher(new URL('/api/auth.test', host), {
        method: 'POST',
        credentials: 'include',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: String(team.token) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status !== 200) throw new Error();
      const auth = (await response.json()) as { ok?: boolean; user_id?: string; error?: string };
      if (auth.ok !== true) throw new RejectedSession(auth.error === 'invalid_auth');
      if (auth.user_id !== userId) throw new RejectedSession();
    } catch (error) {
      if (error instanceof AccountError) throw error;
      throw new AccountError('Could not verify the Slack session. Check your connection and try again.');
    }
  }
  async function capture(tabId: number, state: AccountState, label?: string) {
    const current = await context(tabId);
    if (!current)
      throw new AccountError('Slack is still signing in. Wait for the client to finish loading, then try again.');
    const before = await cookies();
    if (!before.some((c) => c.name === 'd' && c.value))
      throw new AccountError('The Slack session cookie is unavailable. Sign in again.');
    await verify(current.team, current.team.user_id!);
    const after = await context(tabId);
    if (
      !after ||
      after.teamId !== current.teamId ||
      after.team.user_id !== current.team.user_id ||
      after.team.token !== current.team.token ||
      signature(await cookies()) !== signature(before)
    )
      throw new AccountError('The Slack session changed while saving. Wait for sign-in to finish and try again.');
    const saved: SavedAccount = {
      userId: current.team.user_id!,
      teamId: current.teamId,
      enterpriseId: typeof current.team.enterprise_id === 'string' ? current.team.enterprise_id : undefined,
      updatedAt: Date.now(),
      team: current.team,
      cookies: before,
      label:
        label?.trim() || state.accounts.find((a) => a.userId === current.team.user_id)?.label || current.team.user_id,
    };
    const index = state.accounts.findIndex((a) => a.userId === saved.userId);
    if (index < 0) {
      if (state.accounts.length >= 25)
        throw new AccountError('Remove a saved account before adding another (25 account limit).');
      state.accounts.push(saved);
    } else state.accounts[index] = saved;
    await vault.write(state);
    return publicSummary(saved);
  }
  async function loadTab(id: number, url: string) {
    await api.tabs.update(id, { url });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const tab = await api.tabs.get(id);
      if (tab.url === url && tab.status === 'complete') return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new AccountError('A Slack tab did not finish pausing. Your session has not been switched.');
  }
  const paused = () => api.runtime.getURL('accounts-paused.html');
  async function barrier(block: boolean) {
    if (!api.declarativeNetRequest)
      throw new AccountError('This browser cannot pause Slack requests for account switching.');
    const rules = await api.declarativeNetRequest.getSessionRules();
    await api.declarativeNetRequest.updateSessionRules({
      removeRuleIds: rules.filter((r) => r.id === ACCOUNT_BARRIER_ID).map((r) => r.id),
      addRules: block
        ? [
            {
              id: ACCOUNT_BARRIER_ID,
              priority: 1_000_000,
              action: { type: 'block' },
              condition: { initiatorDomains: ['slack.com'] },
            },
          ]
        : [],
    });
  }
  async function clearClient() {
    const chromium = api.runtime.getURL('').startsWith('chrome-extension:');
    await api.browsingData.remove(
      chromium ? { origins: [SLACK] } : { hostnames: ['app.slack.com'], cookieStoreId: 'firefox-default' },
      {
        localStorage: true,
        indexedDB: true,
        ...(chromium ? { serviceWorkers: true as const, cacheStorage: true as const } : {}),
      },
    );
  }
  async function stage(config: string | null, state: AccountState) {
    const journal = state.journal!;
    let tab = (await Promise.all(journal.tabs.map((t) => api.tabs.get(t.id).catch(() => null)))).find(
      (t) => t?.url === paused(),
    );
    if (!tab) {
      tab = await api.tabs.create({ url: paused(), active: false });
      if (tab.id === undefined) throw new AccountError('Could not create the account handoff tab.');
      journal.tabs.push({ id: tab.id, url: SLACK + '/client' });
      await vault.write(state);
    }
    if (tab.id === undefined) throw new AccountError('The account handoff tab closed.');
    // A plain same-origin document lets us write the handoff before any Slack JS boots.
    await loadTab(tab.id, SLACK + '/robots.txt');
    await api.scripting.executeScript({ target: { tabId: tab.id }, func: writeAccountContext, args: [config] });
    await loadTab(tab.id, paused());
    return tab.id;
  }
  async function resume(journal: Journal, destination?: string) {
    for (const tab of journal.tabs) {
      // A closed tab is fine; a user-navigated tab is no longer ours to replace.
      const current = await api.tabs.get(tab.id).catch(() => null);
      if (current?.url === paused()) await api.tabs.update(tab.id, { url: destination ?? tab.url });
    }
  }
  async function recover(state: AccountState) {
    if (!state.journal) return;
    await requirePermissions();
    const journal = state.journal;
    await barrier(true);
    if (!journal.committed) {
      // Also pause any Slack clients the user opened after the worker stopped.
      const tabs = await clients();
      for (const tab of tabs) {
        if (tab.id === undefined || journal.tabs.some((saved) => saved.id === tab.id)) continue;
        journal.tabs.push({ id: tab.id, url: tab.url === paused() ? SLACK + '/client' : tab.url! });
      }
      // Persist new routes before unloading tabs, so another interruption can resume them too.
      await vault.write(state);
      for (const tab of tabs) if (tab.id !== undefined) await loadTab(tab.id, paused());
      await clearClient();
      await installCookies(journal.cookies);
      await stage(journal.config, state);
    }
    await barrier(false);
    await resume(journal, journal.committed);
    delete state.journal;
    await vault.write(state);
  }
  async function transition(userId: string | null, source: string) {
    await requirePermissions();
    const state = await vault.read();
    await recover(state);
    if (source) await capture(Number(source), state);
    const target = userId ? state.accounts.find((a) => a.userId === userId) : null;
    if (userId && (!target || !ID.test(target.userId))) throw new AccountError('The saved account is unavailable.');
    const tabs = await clients();
    const current = tabs.find((t) => CLIENT.test(t.url ?? ''));
    const original = current?.id !== undefined ? await context(current.id) : null;
    const journal: Journal = {
      tabs: tabs.flatMap((t) => (t.id !== undefined && t.url ? [{ id: t.id, url: t.url }] : [])),
      cookies: await cookies(),
      config: original?.config ?? null,
    };
    state.journal = journal;
    await vault.write(state); // Recovery record commits before the first session mutation.
    try {
      await barrier(true);
      for (const tab of journal.tabs) await loadTab(tab.id, paused());
      await clearClient();
      await installCookies(target?.cookies ?? []);
      if (target) {
        try {
          await verify(target.team, target.userId);
        } catch (error) {
          // Stale companions can invalidate a valid saved d/token pair. Never borrow the active account's cookies.
          if (!(error instanceof RejectedSession) || !error.retryDOnly || !target.cookies.some((c) => c.name !== 'd'))
            throw error;
          const primary = target.cookies.filter((c) => c.name === 'd');
          await installCookies(primary);
          await verify(target.team, target.userId);
          target.cookies = primary;
        }
      }
      const config = target
        ? JSON.stringify({
            teams: { [target.teamId]: target.team },
            orderedTeamIds: [target.teamId],
            lastActiveTeamId: target.teamId,
          })
        : null;
      const staging = await stage(config, state);
      if (target && signature(await cookies()) !== signature(target.cookies))
        throw new AccountError(
          'Another Slack sign-in changed the session during switching. Your previous session was restored; try again after sign-in finishes.',
        );
      const destination = target ? SLACK + '/client/' + target.teamId : SLACK + '/signin';
      journal.committed = destination;
      await vault.write(state);
      await barrier(false);
      // Other tabs remain paused while adding an account; they must not boot the old identity.
      if (target) await resume(journal, destination);
      else await api.tabs.update(staging, { url: destination, active: true });
      delete state.journal;
      await vault.write(state);
      return true;
    } catch (error) {
      try {
        await recover(state);
      } catch {
        throw new AccountError(
          'The switch was interrupted. Slack tabs remain paused. Reopen the account manager to recover before continuing.',
        );
      }
      if (journal.committed) return true;
      if (error instanceof AccountError) throw error;
      throw new AccountError('Account switching failed. Your previous session was restored.');
    }
  }
  return {
    list: async () => (await vault.read()).accounts.map(publicSummary),
    status: async () => ({
      permission: await permissions(),
      busy,
      recovery: !!(await vault.read()).journal,
      tabs: (await api.tabs.query({ url: ['https://app.slack.com/client*'] }))
        .filter(isNormal)
        .map((t) => ({ id: t.id })),
      accounts: (await vault.read()).accounts.map(publicSummary),
    }),
    capture: (tabId: string, label?: string) =>
      serial(async () => {
        await requirePermissions();
        const state = await vault.read();
        await recover(state);
        return capture(Number(tabId), state, label);
      }),
    forget: (userId: string) =>
      serial(async () => {
        const state = await vault.read();
        state.accounts = state.accounts.filter((a) => a.userId !== userId);
        await vault.write(state);
        return true;
      }),
    switchTo: (userId: string, source: string) => serial(() => transition(userId, source)),
    add: (source: string) => serial(() => transition(null, source)),
    recover: () =>
      serial(async () => {
        const state = await vault.read();
        if (state.journal) await recover(state);
        return true;
      }),
  };
}
