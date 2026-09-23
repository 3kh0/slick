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
  const text = await ctx.secrets.read(SECRET_KEY);
  if (text === null) return {};
  const accounts = object(JSON.parse(text));
  if (!accounts) throw new Error('saved accounts are unreadable');
  return accounts as Record<string, StoredAccount>;
}

async function save(ctx: MainCtx, accounts: Record<string, StoredAccount>): Promise<void> {
  if (!(await ctx.secrets.write(SECRET_KEY, JSON.stringify(accounts)))) throw new Error('could not save accounts');
}

let queue: Promise<unknown> = Promise.resolve();
function update<T>(ctx: MainCtx, change: (accounts: Record<string, StoredAccount>) => T): Promise<T> {
  const run = queue.then(async () => {
    const accounts = await load(ctx);
    const result = change(accounts);
    await save(ctx, accounts);
    return result;
  });
  queue = run.catch(() => {});
  return run;
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
  await update(ctx, (accounts) => {
    accounts[account.userId] = account;
  });
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
      await update(ctx, (accounts) => {
        delete accounts[userId];
      });
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
