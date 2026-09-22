// Slack's own client state, kept in localStorage under `localConfig_v2`.
//
// This is where the per-workspace API token lives, which is what `api.userAPI`
// needs to call the Web API as the signed-in user.

export type LocalConfigTeam = {
  id?: string;
  name?: string;
  domain?: string;
  user_id?: string;
  token?: string;
  url?: string;
  [key: string]: unknown;
};

export type LocalConfig = {
  teams?: Record<string, LocalConfigTeam>;
  lastActiveTeamId?: string;
  orderedTeamIds?: string[];
  [key: string]: unknown;
};

export function readLocalConfig(): LocalConfig {
  try {
    return JSON.parse(localStorage.getItem('localConfig_v2') || '{}');
  } catch {
    return {};
  }
}

function routeTeamId(): string | undefined {
  const match = /^\/client\/([^/]+)/.exec(globalThis.location?.pathname ?? '');
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** The entry for the workspace currently on screen, if there is one. */
export function getActiveTeam(config: LocalConfig = readLocalConfig()): LocalConfigTeam | undefined {
  // `lastActiveTeamId` is shared by every Slack window. The client route is
  // window-local; if it names an unknown team, failing is safer than sending a
  // request with another workspace's credentials.
  const routed = routeTeamId();
  const teamId = routed ?? config.lastActiveTeamId;
  return teamId ? config.teams?.[teamId] : undefined;
}
