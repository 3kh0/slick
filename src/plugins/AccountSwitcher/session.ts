import type { LocalConfig, LocalConfigTeam } from '../../app/slack/localConfig.ts';

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
