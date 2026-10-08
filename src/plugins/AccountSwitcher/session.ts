import type { LocalConfig, LocalConfigTeam } from '../../app/slack/localConfig.ts';
import type { AccountSummary } from './types.ts';

// Keep compatibility with older extension summaries that only describe the primary workspace.
export type WorkspaceAccountSummary = AccountSummary;

export type SavedWorkspace = {
  accountId: string;
  teamId: string;
  name: string;
  domain?: string;
  iconUrl?: string;
};

export function workspaceIconUrl(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const icons = value as Record<string, unknown>;
  for (const key of ['image_68', 'image_44', 'image_88', 'image_34']) {
    const candidate = icons[key];
    if (typeof candidate !== 'string') continue;
    try {
      const url = new URL(candidate);
      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        (url.hostname === 'slack-edge.com' || url.hostname.endsWith('.slack-edge.com'))
      )
        return url.href;
    } catch {
      /* Missing or malformed icons use the letter fallback. */
    }
  }
  return undefined;
}

/** Navigation metadata only: credentials remain in the privileged session store. */
export function savedWorkspaces(accounts: WorkspaceAccountSummary[]): SavedWorkspace[] {
  const workspaces = new Map<string, SavedWorkspace>();
  for (const account of accounts.toSorted((a, b) => b.updatedAt - a.updatedAt)) {
    const memberships = account.workspaces ?? { [account.teamId]: { userId: account.userId } };
    for (const [teamId, team] of Object.entries(memberships)) {
      // Grid's enterprise root and concrete team are one native switcher entry.
      if (team.enterpriseId && memberships[team.enterpriseId]) continue;
      if (workspaces.has(teamId)) continue;
      workspaces.set(teamId, {
        accountId: account.userId,
        teamId,
        name: team.name || (teamId === account.teamId ? account.label?.split(' · ')[0] : undefined) || teamId,
        domain: team.domain,
        ...(team.iconUrl ? { iconUrl: team.iconUrl } : {}),
      });
    }
  }
  return [...workspaces.values()];
}

export function scopedMemberId(
  account: WorkspaceAccountSummary,
  teamId: string | null,
  enterpriseId: string | null,
): string | undefined {
  if (!teamId) return undefined;
  if (account.workspaces) {
    const exact = account.workspaces[teamId];
    if (exact) return exact.userId;
    // An Enterprise Grid sibling is not proof of membership in this concrete
    // workspace. Only the enterprise-root route may use a concrete alias.
    return teamId === enterpriseId
      ? Object.values(account.workspaces).find((workspace) => workspace.enterpriseId === enterpriseId)?.userId
      : undefined;
  }
  return account.teamId === teamId || (teamId === enterpriseId && account.enterpriseId === enterpriseId)
    ? account.userId
    : undefined;
}

export function workspaceSnapshot(
  config: LocalConfig,
): Pick<LocalConfig, 'teams' | 'orderedTeamIds' | 'lastActiveTeamId'> {
  return {
    teams: config.teams,
    orderedTeamIds: config.orderedTeamIds,
    lastActiveTeamId: config.lastActiveTeamId,
  };
}

// localConfig can lag behind an /ssb/redirect login; never capture it under the old identity.
export function captureCandidate(
  config: LocalConfig,
  teamId: string | undefined,
  liveUserId: string | undefined,
): LocalConfigTeam | null {
  const team = teamId ? config.teams?.[teamId] : undefined;
  if (!liveUserId || team?.user_id !== liveUserId || !team.token) return null;
  return team;
}
