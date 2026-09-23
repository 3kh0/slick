import { type LocalConfigTeam, readLocalConfig } from '../slack/localConfig.ts';

export const PENDING_ACCOUNT_SWITCH_KEY = 'slick:pendingAccountSwitch';

export type PendingAccountSwitch = {
  userId: string;
  teamId: string;
  team: LocalConfigTeam;
};

const TEAM_ID = /^[A-Z][A-Z0-9]{5,}$/;

/** Apply the one-reload handoff before Slack reads its local configuration. */
export function applyPendingAccountSwitch(): void {
  try {
    const pending = localStorage.getItem(PENDING_ACCOUNT_SWITCH_KEY);
    if (!pending) return;
    localStorage.removeItem(PENDING_ACCOUNT_SWITCH_KEY);

    const account = JSON.parse(pending) as Partial<PendingAccountSwitch> | null;
    const teamId = account?.teamId;
    if (typeof teamId !== 'string' || !TEAM_ID.test(teamId) || typeof account?.team?.token !== 'string') return;

    const localConfig = readLocalConfig();
    if (!localConfig.teams || typeof localConfig.teams !== 'object') localConfig.teams = {};
    localConfig.teams[teamId] = { ...localConfig.teams[teamId], ...account.team };
    localConfig.lastActiveTeamId = teamId;
    if (!Array.isArray(localConfig.orderedTeamIds)) localConfig.orderedTeamIds = [];
    if (!localConfig.orderedTeamIds.includes(teamId)) localConfig.orderedTeamIds.push(teamId);

    localStorage.setItem('localConfig_v2', JSON.stringify(localConfig));
  } catch (error) {
    console.warn('[slick] pending account switch skipped:', error);
  }
}
