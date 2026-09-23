import type { LocalConfigTeam } from '../../app/slack/localConfig.ts';

export type AccountSummary = {
  userId: string;
  teamId: string;
  enterpriseId?: string;
  updatedAt: number;
};

export type StoredAccount = AccountSummary & {
  team: LocalConfigTeam;
  xoxd: string;
};
