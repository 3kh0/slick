import type { MainCtx, SlickMainPlugin } from '$slick';
import type { LocalConfigTeam } from '../../app/slack/localConfig.ts';
import type { AccountSummary, SessionCookie, StoredAccount } from './types.ts';
import { serialQueue } from '../../shared/queue.ts';
import { record } from '../../shared/objects.ts';

const SLACK_URL = 'https://app.slack.com';
const COOKIE_DOMAIN = '.slack.com';
const SECRET_KEY = 'accounts';
const SESSION_COOKIES = ['d', 'd-s', 'uc'];
const ID = /^[A-Z][A-Z0-9]{5,}$/;

function object(value: unknown): Record<string, unknown> | null {
  return record(value) ? value : null;
}

function validTeam(value: unknown): LocalConfigTeam | null {
  const team = object(value);
  if (!team) return null;
  if (typeof team.user_id !== 'string' || !ID.test(team.user_id)) return null;
  if (typeof team.token !== 'string' || !team.token) return null;
  return team as LocalConfigTeam;
}

async function load(ctx: MainCtx): Promise<Record<string, StoredAccount>> {
  const text = await ctx.secrets.read(SECRET_KEY);
  if (text === null) return {};
  const accounts = object(JSON.parse(text));
  if (!accounts) throw new Error('saved accounts are unreadable');
  return accounts as Record<string, StoredAccount>;
}

async function save(ctx: MainCtx, accounts: Record<string, StoredAccount>): Promise<void> {
  if (!(await ctx.secrets.write(SECRET_KEY, JSON.stringify(accounts)))) throw new Error('could not save accounts');
}

const enqueue = serialQueue();
function update<T>(ctx: MainCtx, change: (accounts: Record<string, StoredAccount>) => T): Promise<T> {
  return enqueue(async () => {
    const accounts = await load(ctx);
    const result = change(accounts);
    await save(ctx, accounts);
    return result;
  });
}

function summary(account: StoredAccount): AccountSummary {
  return {
    userId: account.userId,
    teamId: account.teamId,
    enterpriseId: account.enterpriseId,
    updatedAt: account.updatedAt,
  };
}

async function readSessionCookies(ctx: MainCtx): Promise<SessionCookie[]> {
  const cookies: SessionCookie[] = [];
  for (const name of SESSION_COOKIES) {
    const cookie = await ctx.cookies.get({ url: SLACK_URL, name });
    if (!cookie?.value || (name !== 'd' && cookie.name !== name)) continue;
    cookies.push({
      name,
      value: cookie.value,
      domain: cookie.domain ?? COOKIE_DOMAIN,
      path: cookie.path ?? '/',
      secure: cookie.secure ?? true,
      httpOnly: cookie.httpOnly ?? true,
      sameSite: cookie.sameSite ?? 'lax',
      expirationDate: cookie.expirationDate,
    });
  }
  return cookies;
}

function accountCookies(account: StoredAccount): SessionCookie[] {
  const cookies = (account.sessionCookies ?? []).filter(
    (cookie) =>
      SESSION_COOKIES.includes(cookie.name) &&
      typeof cookie.value === 'string' &&
      /(^|\.)slack\.com$/.test(cookie.domain ?? COOKIE_DOMAIN),
  );
  return [
    {
      name: 'd',
      domain: COOKIE_DOMAIN,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60,
      ...cookies.find((cookie) => cookie.name === 'd'),
      value: account.xoxd,
    },
    ...cookies.filter((cookie) => cookie.name !== 'd'),
  ];
}

async function capture(ctx: MainCtx, teamId: unknown, value: unknown): Promise<AccountSummary> {
  if (typeof teamId !== 'string' || !ID.test(teamId)) throw new Error('bad team id');
  const team = validTeam(value);
  if (!team) throw new Error('bad account data');

  const sessionCookies = await readSessionCookies(ctx);
  const cookie = sessionCookies.find((entry) => entry.name === 'd');
  if (!cookie?.value) throw new Error('session cookie unavailable');

  const account: StoredAccount = {
    userId: team.user_id!,
    teamId,
    enterpriseId: typeof team.enterprise_id === 'string' ? team.enterprise_id : undefined,
    team: { ...team },
    xoxd: cookie.value,
    sessionCookies,
    updatedAt: Date.now(),
  };
  ctx.log?.('capture.start', { cookieCount: sessionCookies.length });
  account.sessionCookies = await checkyCheck(ctx, account);
  // A redirect may replace the cookie while auth.test is in flight.
  if (JSON.stringify(await readSessionCookies(ctx)) !== JSON.stringify(sessionCookies))
    throw new Error('The Slack session changed while saving the account. Try again.');
  await update(ctx, (accounts) => {
    accounts[account.userId] = account;
  });
  ctx.log?.('capture.saved', { success: true });
  return summary(account);
}

class InvalidSession extends Error {}

async function checkyCheck(ctx: MainCtx, account: StoredAccount): Promise<SessionCookie[]> {
  let host: URL;
  try {
    host = new URL(account.team.url ?? '');
    if (host.protocol !== 'https:' || !host.hostname.endsWith('.slack.com') || host.username || host.password)
      throw new Error('bad host');
  } catch {
    throw new Error('This saved account is incomplete. Remove it and add it again.');
  }

  const probe = async (cookies: SessionCookie[]) => {
    try {
      const response = await ctx.net.fetch(new URL('/api/auth.test', host).href, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
        },
        body: new URLSearchParams({ token: account.team.token! }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status !== 200) throw new Error('auth unavailable');
      const result: { ok?: boolean; error?: string; user_id?: string } = JSON.parse(response.body);
      if (!result || typeof result.ok !== 'boolean') throw new Error('bad auth response');
      ctx.log?.('auth.result', { success: result.ok, cookieCount: cookies.length });
      return result;
    } catch {
      ctx.log?.('auth.unavailable', { reason: 'failed' });
      throw new Error('Could not verify the saved account. Check your connection and try again.');
    }
  };
  let cookies = accountCookies(account);
  let result = await probe(cookies);
  if (!result.ok && result.error === 'invalid_auth' && cookies.some((cookie) => cookie.name !== 'd')) {
    // Companions may be stale or scoped to a different host. Retry ONLY this
    // account's saved token + saved d, never the active account's cookie jar.
    cookies = cookies.filter((cookie) => cookie.name === 'd');
    result = await probe(cookies);
  }
  if (!result.ok) {
    const code =
      typeof result.error === 'string' && /^[a-z_]{1,64}$/.test(result.error) ? result.error : 'unknown_error';
    if (['invalid_auth', 'not_authed', 'token_revoked', 'token_expired', 'account_inactive'].includes(code))
      throw new InvalidSession(`Slack rejected this session (${code}). Sign in to this account again.`);
    throw new Error(`Slack could not verify this session (${code}). Try again.`);
  }
  if (result.user_id !== account.userId)
    throw new Error('The Slack session does not match this account. Wait for sign-in to finish and try again.');
  return cookies;
}

const plugin: SlickMainPlugin = {
  id: 'AccountSwitcher',
  capabilities: ['cookies', 'secrets', 'net', 'shell'],

  ready(ctx) {
    // Covers OAuth/SSB redirects, including sign-ins completed outside the client window.
    // Never intercept the OAuth code or send the HttpOnly cookie to the renderer.
    ctx.log?.('plugin.ready', {});
    const stopCookies = ctx.cookies.onChanged((cookie, removed) => {
      if (SESSION_COOKIES.includes(cookie.name) && /(^|\.)slack\.com$/.test(cookie.domain ?? '')) {
        ctx.log?.('session.cookie-changed', { success: !removed });
        ctx.emit('session-changed');
      }
    });
    const stopSignIn = ctx.sessions.onSignIn(async (sender, url, options) => {
      // A manual SSB link can arrive before the polling capture has run.
      if (/^https:\/\/app\.slack\.com\/client(?:\/|$)/.test(sender.getURL())) {
        const config = await sender.executeJavaScript("JSON.parse(localStorage.getItem('localConfig_v2') || '{}')");
        const route = new URL(sender.getURL()).pathname.split('/')[2];
        const teamId = route || config.lastActiveTeamId;
        const team = config.teams?.[teamId];
        if (teamId && validTeam(team)) {
          try {
            await capture(ctx, teamId, team);
          } catch (error) {
            if (!(error instanceof InvalidSession)) throw error;
          }
        }
      }
      await ctx.sessions.navigate(
        sender,
        url,
        { action: 'reset' },
        async () => {
          for (const name of SESSION_COOKIES) await ctx.cookies.remove(SLACK_URL, name);
        },
        options,
      );
    });
    return () => {
      stopCookies();
      stopSignIn();
    };
  },

  rpc: {
    async list(ctx) {
      return Object.values(await load(ctx)).map(summary);
    },

    async capture(ctx, args) {
      return capture(ctx, args[0], args[1]);
    },

    async forget(ctx, args) {
      const [userId] = args;
      if (typeof userId !== 'string' || !ID.test(userId)) throw new Error('bad user id');
      await update(ctx, (accounts) => {
        delete accounts[userId];
      });
    },

    async switchTo(ctx, args, sender) {
      const [userId] = args;
      if (typeof userId !== 'string' || !ID.test(userId)) throw new Error('bad user id');
      const account = (await load(ctx))[userId];
      if (!account?.team?.token || !account.xoxd) throw new Error('saved account is unavailable');
      // Verify ONLY the saved pair. Probing a different account's live cookie
      // with this token defeats sign-in isolation and cannot un-revoke a token.
      const verifiedCookies = await checkyCheck(ctx, account);

      const previous = await readSessionCookies(ctx);
      const restore = async (cookies: SessionCookie[]) => {
        for (const name of SESSION_COOKIES) await ctx.cookies.remove(SLACK_URL, name);
        for (const cookie of cookies)
          await ctx.cookies.set({
            ...cookie,
            url: SLACK_URL,
          });
      };
      const handoff = { userId: account.userId, teamId: account.teamId, team: account.team };
      await ctx.sessions.navigate(sender, `${SLACK_URL}/client/${account.teamId}`, handoff, async () => {
        try {
          await restore(verifiedCookies);
        } catch (error) {
          try {
            await restore(previous);
          } catch {
            throw new Error('Could not restore Slack session cookies. Sign in again to recover.', { cause: error });
          }
          throw error;
        }
      });
      return handoff;
    },

    async addAccount(ctx, args, sender) {
      const [domain] = args;
      if (domain !== undefined && (typeof domain !== 'string' || !/^[a-z0-9-]+$/.test(domain)))
        throw new Error('bad workspace domain');
      const url = domain && domain !== 'hackclub' ? `https://${domain}.slack.com` : SLACK_URL;
      await ctx.sessions.navigate(sender, url, { action: 'reset' }, async () => {
        for (const name of SESSION_COOKIES) await ctx.cookies.remove(SLACK_URL, name);
      });
      if (domain === 'hackclub') await ctx.shell.openExternal('https://auth.hackclub.com');
    },
  },
};

export default plugin;
