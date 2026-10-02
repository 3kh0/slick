import type { LocalConfigTeam } from '../../app/slack/localConfig.ts';

export type AccountSummary = {
  userId: string;
  teamId: string;
  enterpriseId?: string;
  updatedAt: number;
};

export type SessionCookie = Pick<
  Electron.CookiesSetDetails,
  'name' | 'value' | 'domain' | 'path' | 'secure' | 'httpOnly' | 'sameSite' | 'expirationDate'
> & { name: string; value: string };

export type StoredAccount = AccountSummary & {
  team: LocalConfigTeam;
  xoxd: string;
  sessionCookies?: SessionCookie[];
};
