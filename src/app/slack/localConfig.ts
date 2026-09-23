// Slack's `localConfig_v2` localStorage entry holds the per-workspace API
// token `api.userAPI` uses.

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

export function getActiveTeam(config: LocalConfig = readLocalConfig()): LocalConfigTeam | undefined {
  // `lastActiveTeamId` is shared across windows; the route is window-local. If
  // it names an unknown team, fail rather than use another workspace's token.
  const routed = routeTeamId();
  const teamId = routed ?? config.lastActiveTeamId;
  return teamId ? config.teams?.[teamId] : undefined;
}
