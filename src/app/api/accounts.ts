import { type LocalConfigTeam, readLocalConfig } from '../slack/localConfig.ts';

export const PENDING_ACCOUNT_SWITCH_KEY = 'slick:pendingAccountSwitch';

export type PendingAccountSwitch = {
  userId: string;
  teamId: string;
  team: LocalConfigTeam;
};

const TEAM_ID = /^[A-Z][A-Z0-9]{5,}$/;

export function stageAccountRemoval(teamId: string): void {
  if (!TEAM_ID.test(teamId)) throw new Error('bad team id');
  localStorage.setItem(PENDING_ACCOUNT_SWITCH_KEY, JSON.stringify({ action: 'remove', teamId }));
}

/** Apply the one-reload handoff before Slack reads its local configuration. */
export function applyPendingAccountSwitch(strict = false): void {
  try {
    const pending = localStorage.getItem(PENDING_ACCOUNT_SWITCH_KEY);
    if (!pending) return;
    if (!strict) localStorage.removeItem(PENDING_ACCOUNT_SWITCH_KEY);

    const account = JSON.parse(pending) as (Partial<PendingAccountSwitch> & { action?: string }) | null;
    const teamId = account?.teamId;
    if (typeof teamId !== 'string' || !TEAM_ID.test(teamId)) {
      if (strict) throw new Error('bad account handoff');
      return;
    }

    if (account?.action === 'remove') {
      const localConfig = readLocalConfig();
      if (localConfig.teams) delete localConfig.teams[teamId];
      localConfig.orderedTeamIds = (localConfig.orderedTeamIds ?? []).filter((id) => id !== teamId);
      if (localConfig.lastActiveTeamId === teamId) delete localConfig.lastActiveTeamId;
      localStorage.setItem('localConfig_v2', JSON.stringify(localConfig));
      localStorage.removeItem(PENDING_ACCOUNT_SWITCH_KEY);
      return;
    }
    if (typeof account?.team?.token !== 'string' || !account.team.token) {
      if (strict) throw new Error('bad account handoff');
      return;
    }

    const localConfig = readLocalConfig();
    // Never boot another account's workspace token against the target cookie jar.
    localConfig.teams = { [teamId]: { ...account.team } };
    localConfig.lastActiveTeamId = teamId;
    localConfig.orderedTeamIds = [teamId];

    localStorage.setItem('localConfig_v2', JSON.stringify(localConfig));
    localStorage.removeItem(PENDING_ACCOUNT_SWITCH_KEY);
  } catch (error) {
    if (strict) throw error;
    console.warn('[slick] pending account switch skipped:', error);
  }
}
