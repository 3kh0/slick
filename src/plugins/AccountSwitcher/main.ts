import type { MainCtx, SlickMainPlugin } from '$slick';
import type { LocalConfigTeam } from '../../app/slack/localConfig.ts';
import type { AccountSummary, StoredAccount } from './types.ts';

const SLACK_URL = 'https://app.slack.com';
const COOKIE_DOMAIN = '.slack.com';
const SECRET_KEY = 'accounts';
const SESSION_COOKIES = ['d', 'd-s', 'uc'];
const ID = /^[A-Z][A-Z0-9]{5,}$/;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function validTeam(value: unknown): LocalConfigTeam | null {
  const team = object(value);
  if (!team) return null;
  if (typeof team.user_id !== 'string' || !ID.test(team.user_id)) return null;
  if (typeof team.token !== 'string' || !team.token) return null;
  return team as LocalConfigTeam;
}

async function load(ctx: MainCtx): Promise<Record<string, StoredAccount>> {
  try {
    return JSON.parse((await ctx.secrets.read(SECRET_KEY)) || '{}') as Record<string, StoredAccount>;
  } catch {
    return {};
  }
}

async function save(ctx: MainCtx, accounts: Record<string, StoredAccount>): Promise<void> {
  if (!(await ctx.secrets.write(SECRET_KEY, JSON.stringify(accounts)))) throw new Error('could not save accounts');
}

function summary(account: StoredAccount): AccountSummary {
  return {
    userId: account.userId,
    teamId: account.teamId,
    enterpriseId: account.enterpriseId,
    updatedAt: account.updatedAt,
  };
}

async function capture(ctx: MainCtx, teamId: unknown, value: unknown): Promise<AccountSummary> {
  if (typeof teamId !== 'string' || !ID.test(teamId)) throw new Error('bad team id');
  const team = validTeam(value);
  if (!team) throw new Error('bad account data');

  const cookie = await ctx.cookies.get({ url: SLACK_URL, name: 'd' });
  if (!cookie?.value) throw new Error('session cookie unavailable');

  const account: StoredAccount = {
    userId: team.user_id!,
    teamId,
    enterpriseId: typeof team.enterprise_id === 'string' ? team.enterprise_id : undefined,
    team: { ...team },
    xoxd: cookie.value,
    updatedAt: Date.now(),
  };
  const accounts = await load(ctx);
  accounts[account.userId] = account;
  await save(ctx, accounts);
  return summary(account);
}

const plugin: SlickMainPlugin = {
  id: 'AccountSwitcher',
  capabilities: ['cookies', 'secrets'],

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
      const accounts = await load(ctx);
      delete accounts[userId];
      await save(ctx, accounts);
    },

    async switchTo(ctx, args) {
      const [userId] = args;
      if (typeof userId !== 'string' || !ID.test(userId)) throw new Error('bad user id');
      const account = (await load(ctx))[userId];
      if (!account?.team?.token || !account.xoxd) throw new Error('saved account is unavailable');

      await ctx.cookies.set({
        url: SLACK_URL,
        name: 'd',
        value: account.xoxd,
        domain: COOKIE_DOMAIN,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        expirationDate: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60,
      });
      return { userId: account.userId, teamId: account.teamId, team: account.team };
    },

    async clearSession(ctx) {
      for (const name of SESSION_COOKIES) await ctx.cookies.remove(SLACK_URL, name);
    },
  },
};

export default plugin;
