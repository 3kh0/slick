import type { MainCtx, SlickMainPlugin } from '$slick';
import type { LocalConfigTeam } from '../../app/slack/localConfig.ts';
import { workspaceConfigFor } from '../../app/api/accounts.ts';
import type { AccountSummary, SessionCookie, StoredAccount } from './types.ts';
import { workspaceIconUrl } from './session.ts';
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
const sessionQueue = serialQueue();
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
    label: `${account.team.name || account.team.domain || account.teamId} · ${account.userId}`,
    updatedAt: account.updatedAt,
    workspaces: Object.fromEntries(
      Object.entries(account.workspaceConfig?.teams ?? { [account.teamId]: account.team }).map(([id, team]) => [
        id,
        {
          userId: team.user_id!,
          enterpriseId: typeof team.enterprise_id === 'string' ? team.enterprise_id : undefined,
          name: typeof team.name === 'string' ? team.name : undefined,
          domain: typeof team.domain === 'string' ? team.domain : undefined,
          iconUrl: workspaceIconUrl(team.icon),
        },
      ]),
    ),
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

async function capture(
  ctx: MainCtx,
  teamId: unknown,
  value: unknown,
  config?: unknown,
  readConfig?: () => Promise<unknown>,
): Promise<AccountSummary> {
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
    ...(config === undefined ? {} : { workspaceConfig: workspaceConfigFor(config, teamId, team) }),
  };
  const capturedConfig = account.workspaceConfig;
  const previous = Object.values(await load(ctx)).filter((saved) => saved.xoxd === cookie.value);
  // Older versions saved one record per workspace. Carry omitted memberships
  // forward only from this exact cookie session, then reverify the entire union.
  // Never delete an old singleton just because the live workspace list is smaller.
  const priorTeams = Object.assign(
    {},
    ...previous.map((saved) => saved.workspaceConfig?.teams ?? { [saved.teamId]: saved.team }),
  ) as Record<string, LocalConfigTeam>;
  if (
    previous.some((saved) => saved.workspaceConfig) ||
    Object.keys(priorTeams).some((id) => id !== teamId) ||
    capturedConfig
  ) {
    account.workspaceConfig = workspaceConfigFor(
      {
        teams: { ...priorTeams, ...(capturedConfig?.teams ?? { [teamId]: team }) },
        orderedTeamIds: [
          ...(capturedConfig?.orderedTeamIds ?? [teamId]),
          ...previous.flatMap((saved) => saved.workspaceConfig?.orderedTeamIds ?? [saved.teamId]),
        ],
      },
      teamId,
      team,
    );
  }
  ctx.log?.('capture.start', { cookieCount: sessionCookies.length });
  account.sessionCookies = await verifyWorkspaceSession(ctx, account);
  // A redirect may replace the cookie while auth.test is in flight.
  if (JSON.stringify(await readSessionCookies(ctx)) !== JSON.stringify(sessionCookies))
    throw new Error('The Slack session changed while saving the account. Try again.');
  if (
    readConfig &&
    capturedConfig &&
    JSON.stringify(workspaceConfigFor(await readConfig(), teamId, team)) !== JSON.stringify(capturedConfig)
  )
    throw new Error('The Slack workspace list changed while saving the account. Try again.');
  await update(ctx, (accounts) => {
    // User IDs are workspace-local. One cookie session is one saved login even
    // when visiting its other workspaces yields different member IDs.
    const matching =
      Object.values(accounts).find((saved) => saved.xoxd === account.xoxd) ??
      Object.values(accounts).find((saved) => {
        const oldTeams = saved.workspaceConfig?.teams ?? { [saved.teamId]: saved.team };
        const newTeams = account.workspaceConfig?.teams ?? { [account.teamId]: account.team };
        const ids = Object.keys(newTeams);
        return (
          ids.length === Object.keys(oldTeams).length &&
          ids.every((id) => oldTeams[id]?.user_id === newTeams[id]?.user_id)
        );
      });
    // Cookie rotation may happen on any workspace. Keep the saved ID only when
    // the entire freshly verified membership set matches; never borrow old tokens.
    if (matching) account.userId = matching.userId;
    accounts[account.userId] = account;
    for (const [id, saved] of Object.entries(accounts))
      if (id !== account.userId && saved.xoxd === account.xoxd) delete accounts[id];
  });
  ctx.log?.('capture.saved', { success: true });
  return summary(account);
}

class InvalidSession extends Error {}

async function checkyCheck(
  ctx: MainCtx,
  account: StoredAccount,
  initialCookies = accountCookies(account),
  allowFallback = true,
  teamIds?: string[],
): Promise<SessionCookie[]> {
  let host: URL;
  try {
    host = new URL(account.team.url ?? '');
    if (
      host.protocol !== 'https:' ||
      !host.hostname.endsWith('.slack.com') ||
      host.username ||
      host.password ||
      host.port
    )
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
        redirect: 'error',
      });
      if (response.status !== 200) throw new Error('auth unavailable');
      const result: { ok?: boolean; error?: string; user_id?: string; team_id?: string; enterprise_id?: string } =
        JSON.parse(response.body);
      if (!result || typeof result.ok !== 'boolean') throw new Error('bad auth response');
      ctx.log?.('auth.result', { success: result.ok, cookieCount: cookies.length });
      return result;
    } catch {
      ctx.log?.('auth.unavailable', { reason: 'failed' });
      throw new Error('Could not verify the saved account. Check your connection and try again.');
    }
  };
  let cookies = initialCookies;
  let result = await probe(cookies);
  if (allowFallback && !result.ok && result.error === 'invalid_auth' && cookies.some((cookie) => cookie.name !== 'd')) {
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
  if (result.user_id !== account.team.user_id)
    throw new Error('The Slack session does not match this account. Wait for sign-in to finish and try again.');
  if (teamIds && !teamIds.includes(result.team_id ?? '') && !teamIds.includes(result.enterprise_id ?? ''))
    throw new Error('The Slack session does not match this workspace. Wait for sign-in to finish and try again.');
  return cookies;
}

async function verifyWorkspaceSession(ctx: MainCtx, account: StoredAccount): Promise<SessionCookie[]> {
  if (!account.workspaceConfig) return checkyCheck(ctx, account);
  const config = workspaceConfigFor(account.workspaceConfig, account.teamId, account.team);
  const cookies = accountCookies(account);
  const verify = async (bundle: SessionCookie[]) => {
    for (const [id, team] of Object.entries(config.teams)) {
      // Slack also indexes Enterprise Grid under an E ID. Its auth.test may
      // return the concrete T ID; accept only an alias from this same snapshot.
      const ids = [
        id,
        ...Object.entries(config.teams)
          .filter(
            ([, alias]) => alias.enterprise_id === id && alias.user_id === team.user_id && alias.token === team.token,
          )
          .map(([aliasId]) => aliasId),
      ];
      await checkyCheck(ctx, { ...account, team, teamId: id }, bundle, false, ids);
    }
    return bundle;
  };
  try {
    return await verify(cookies);
  } catch (error) {
    if (
      !(error instanceof InvalidSession) ||
      !error.message.includes('(invalid_auth)') ||
      !cookies.some((cookie) => cookie.name !== 'd')
    )
      throw error;
    // Reverify the WHOLE set with one bundle; never mix successes from different jars.
    return verify(cookies.filter((cookie) => cookie.name === 'd'));
  }
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
    const stopSignIn = ctx.sessions.onSignIn((sender, url, options) =>
      sessionQueue(async () => {
        // A manual SSB link can arrive before the polling capture has run.
        const client = /^https:\/\/app\.slack\.com\/client(?:\/|$)/.test(sender.getURL())
          ? sender
          : ctx.sessions.clients?.(sender)[0];
        if (client) {
          const config = await client.executeJavaScript("JSON.parse(localStorage.getItem('localConfig_v2') || '{}')");
          const route = new URL(client.getURL()).pathname.split('/')[2];
          const teamId = route || config.lastActiveTeamId;
          const team = config.teams?.[teamId];
          if (teamId && validTeam(team)) {
            try {
              await capture(ctx, teamId, team, config, () =>
                client.executeJavaScript("JSON.parse(localStorage.getItem('localConfig_v2') || '{}')"),
              );
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
      }),
    );
    return () => {
      stopCookies();
      stopSignIn();
    };
  },

  rpc: {
    async list(ctx) {
      return Object.values(await load(ctx)).map(summary);
    },

    async capture(ctx, args, sender) {
      return sessionQueue(() =>
        capture(
          ctx,
          args[0],
          args[1],
          args[2],
          args[2] !== undefined && sender.executeJavaScript
            ? () => sender.executeJavaScript("JSON.parse(localStorage.getItem('localConfig_v2') || '{}')")
            : undefined,
        ),
      );
    },

    async forget(ctx, args) {
      const [userId] = args;
      if (typeof userId !== 'string' || !ID.test(userId)) throw new Error('bad user id');
      await update(ctx, (accounts) => {
        delete accounts[userId];
      });
    },

    async switchTo(ctx, args, sender) {
      return sessionQueue(async () => {
        const [userId] = args;
        if (typeof userId !== 'string' || !ID.test(userId)) throw new Error('bad user id');
        const account = (await load(ctx))[userId];
        if (!account?.team?.token || !account.xoxd) throw new Error('saved account is unavailable');
        // Verify ONLY the saved pair. Probing a different account's live cookie
        // with this token defeats sign-in isolation and cannot un-revoke a token.
        const verifiedCookies = await verifyWorkspaceSession(ctx, account);

        const previous = await readSessionCookies(ctx);
        const restore = async (cookies: SessionCookie[]) => {
          for (const name of SESSION_COOKIES) await ctx.cookies.remove(SLACK_URL, name);
          for (const cookie of cookies)
            await ctx.cookies.set({
              ...cookie,
              url: SLACK_URL,
            });
        };
        const requestedTeam = args[1];
        const savedConfig = account.workspaceConfig;
        const teams = savedConfig?.teams ?? { [account.teamId]: account.team };
        if (requestedTeam !== undefined && (typeof requestedTeam !== 'string' || !ID.test(requestedTeam)))
          throw new Error('bad team id');
        const destination =
          typeof requestedTeam === 'string'
            ? teams[requestedTeam]
              ? requestedTeam
              : Object.keys(teams).find((id) => teams[id]!.enterprise_id === requestedTeam)
            : account.teamId;
        if (!destination) throw new Error('This saved login does not belong to the current workspace.');
        const handoff = {
          userId: account.userId,
          teamId: destination,
          team: teams[destination]!,
          ...(savedConfig
            ? { workspaceConfig: workspaceConfigFor(savedConfig, destination, teams[destination]!) }
            : {}),
        };
        await ctx.sessions.navigate(sender, `${SLACK_URL}/client/${destination}`, handoff, async () => {
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
      });
    },

    async addAccount(ctx, args, sender) {
      return sessionQueue(async () => {
        const [domain] = args;
        if (domain !== undefined && (typeof domain !== 'string' || !/^[a-z0-9-]+$/.test(domain)))
          throw new Error('bad workspace domain');
        const url = domain && domain !== 'hackclub' ? `https://${domain}.slack.com` : SLACK_URL;
        await ctx.sessions.navigate(sender, url, { action: 'reset' }, async () => {
          for (const name of SESSION_COOKIES) await ctx.cookies.remove(SLACK_URL, name);
        });
        if (domain === 'hackclub') await ctx.shell.openExternal('https://auth.hackclub.com');
      });
    },
  },
};

export default plugin;
