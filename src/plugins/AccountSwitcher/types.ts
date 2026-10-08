import type { LocalConfigTeam } from '../../app/slack/localConfig.ts';

export type AccountSummary = {
  userId: string;
  teamId: string;
  enterpriseId?: string;
  updatedAt: number;
  label?: string;
  /** Credential-free memberships belonging to this saved login. */
  workspaces?: Record<
    string,
    { userId: string; enterpriseId?: string; name?: string; domain?: string; iconUrl?: string }
  >;
};

export type SessionCookie = Pick<
  Electron.CookiesSetDetails,
  'name' | 'value' | 'domain' | 'path' | 'secure' | 'httpOnly' | 'sameSite' | 'expirationDate'
> & { name: string; value: string };

export type StoredAccount = AccountSummary & {
  team: LocalConfigTeam;
  xoxd: string;
  sessionCookies?: SessionCookie[];
  workspaceConfig?: import('../../app/api/accounts.ts').WorkspaceConfig;
};
