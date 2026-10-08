import { type LocalConfigTeam, readLocalConfig } from '../slack/localConfig.ts';

export const PENDING_ACCOUNT_SWITCH_KEY = 'slick:pendingAccountSwitch';

export type WorkspaceConfig = {
  teams: Record<string, LocalConfigTeam>;
  orderedTeamIds: string[];
  lastActiveTeamId: string;
};

export type PendingAccountSwitch = {
  userId: string;
  teamId: string;
  team: LocalConfigTeam;
  workspaceConfig?: WorkspaceConfig;
};

/** Only session-local workspace fields travel between cookie jars. */
export function workspaceConfigFor(value: unknown, teamId: string, team: LocalConfigTeam): WorkspaceConfig {
  const config = value as Partial<WorkspaceConfig> | undefined;
  const candidates = config?.teams ?? { [teamId]: team };
  if (!candidates || typeof candidates !== 'object' || Array.isArray(candidates))
    throw new Error('bad workspace configuration');
  const entries = Object.entries(candidates);
  if (!entries.length || entries.length > 200) throw new Error('bad workspace configuration');
  const teams: Record<string, LocalConfigTeam> = {};
  for (const [id, candidate] of entries) {
    if (
      !TEAM_ID.test(id) ||
      !candidate ||
      typeof candidate !== 'object' ||
      typeof candidate.token !== 'string' ||
      !candidate.token ||
      typeof candidate.user_id !== 'string' ||
      !TEAM_ID.test(candidate.user_id)
    )
      throw new Error('bad workspace configuration');
    teams[id] = { ...candidate };
  }
  if (teams[teamId]?.token !== team.token || teams[teamId]?.user_id !== team.user_id)
    throw new Error('active workspace does not match the saved configuration');
  const ordered = Array.isArray(config?.orderedTeamIds) ? config.orderedTeamIds : [];
  const orderedTeamIds = [
    ...new Set([...ordered.filter((id) => typeof id === 'string' && id in teams), ...Object.keys(teams)]),
  ];
  return { teams, orderedTeamIds, lastActiveTeamId: teamId };
}

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
    // Replace, never merge: the main process verified this entire set with the
    // destination cookie jar. Legacy handoffs still restore one workspace.
    const workspaceConfig = workspaceConfigFor(account.workspaceConfig, teamId, account.team);
    localConfig.teams = workspaceConfig.teams;
    localConfig.lastActiveTeamId = workspaceConfig.lastActiveTeamId;
    localConfig.orderedTeamIds = workspaceConfig.orderedTeamIds;

    localStorage.setItem('localConfig_v2', JSON.stringify(localConfig));
    localStorage.removeItem(PENDING_ACCOUNT_SWITCH_KEY);
  } catch (error) {
    if (strict) throw error;
    console.warn('[slick] pending account switch skipped:', error);
  }
}
