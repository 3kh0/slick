// Calls Slack's Web API as the signed-in user with the tokens Slack's own page
// keeps in localStorage (`localConfig_v2`), like Slick's `userAPI`. Unlike it,
// this tries every token that can act for the window's route: on Enterprise
// Grid the route is the org (`E…`), and huddle methods want a workspace token,
// with the org token as the fallback.

/** One workspace (or org) the page is signed in to. */
export interface TeamCredential {
  id: string;
  token: string;
  /** e.g. "https://hackclub.slack.com/" */
  url: string;
  /** Your Slack user id in this team. */
  userId: string;
}

type RawTeam = { id?: unknown; token?: unknown; url?: unknown; user_id?: unknown; enterprise_id?: unknown };

export class SlackApiError extends Error {
  readonly method: string;
  readonly code: string;

  constructor(method: string, code: string) {
    super(`Slack refused ${method}: ${code}`);
    this.method = method;
    this.code = code;
  }
}

export function readLocalConfigTeams(storage: Pick<Storage, 'getItem'> = localStorage): Record<string, RawTeam> {
  try {
    const config = JSON.parse(storage.getItem('localConfig_v2') || '{}') as { teams?: Record<string, RawTeam> };
    return config.teams ?? {};
  } catch {
    return {};
  }
}

/** The `T…` / `E…` id in a `/client/<id>/…` path. */
export function routeTeamId(pathname: string): string | undefined {
  return /^\/client\/([TE][A-Z0-9]+)/.exec(pathname)?.[1];
}

function credentialOf(team: RawTeam | undefined): TeamCredential | null {
  if (!team || typeof team.token !== 'string' || typeof team.url !== 'string' || typeof team.id !== 'string')
    return null;
  if (!team.token || !/^https:\/\/[a-z0-9.-]+\.slack\.com\/$/.test(team.url)) return null;
  return {
    id: team.id,
    token: team.token,
    url: team.url,
    userId: typeof team.user_id === 'string' ? team.user_id : '',
  };
}

/**
 * Tokens to try for the window's route, best first: on an org route, its
 * workspaces (sorted by id, so the choice is stable), then the org itself.
 */
export function candidateTeams(teams: Record<string, RawTeam>, routeId: string | undefined): TeamCredential[] {
  if (!routeId) return [];
  const workspaces = routeId.startsWith('E')
    ? Object.values(teams)
        .filter((team) => team.enterprise_id === routeId)
        .toSorted((first, second) => String(first.id).localeCompare(String(second.id)))
    : [];
  const ordered = [...workspaces, teams[routeId]].map(credentialOf).filter((team) => team !== null);
  return ordered.filter((team, index) => ordered.findIndex((other) => other.id === team.id) === index);
}

export type SlackParams = Record<string, string | number | boolean>;

function methodUrl(team: TeamCredential, method: string): string {
  const url = new URL(`api/${method}`, team.url);
  // Without this Slack omits the CORS headers the response needs.
  url.searchParams.set('_x_gantry', 'true');
  return url.toString();
}

function formBody(team: TeamCredential, params: SlackParams): FormData {
  const body = new FormData();
  body.set('token', team.token);
  for (const [name, value] of Object.entries(params)) body.set(name, String(value));
  return body;
}

/** One call with one token. `keepalive` lets it finish while the page unloads. */
export async function postSlackMethod<T>(
  team: TeamCredential,
  method: string,
  params: SlackParams,
  { keepalive = false, fetcher = fetch }: { keepalive?: boolean; fetcher?: typeof fetch } = {},
): Promise<T> {
  const response = await fetcher(methodUrl(team, method), {
    method: 'POST',
    credentials: 'include',
    body: formBody(team, params),
    keepalive,
  });
  if (!response.ok)
    throw new Error(`Slack's ${method} answered HTTP ${response.status}. Check your connection and try again.`);
  const json = (await response.json()) as { ok?: boolean; error?: string } & T;
  if (!json.ok) throw new SlackApiError(method, json.error ?? 'unknown_error');
  return json;
}

/**
 * Tries each team's token in order until one works; returns which one did, so
 * later calls about the same huddle (rooms.leave) use the same token.
 */
export async function callWithFallback<T>(
  teams: TeamCredential[],
  method: string,
  params: SlackParams,
  post: typeof postSlackMethod = postSlackMethod,
): Promise<{ result: T; team: TeamCredential }> {
  if (teams.length === 0) {
    throw new Error("Couldn't find a Slack token for this workspace. Reload Slack and try again.");
  }
  let lastError: unknown;
  for (const team of teams) {
    try {
      return { result: await post<T>(team, method, params), team };
    } catch (error) {
      lastError = error;
      // Network/HTTP failures won't be fixed by a different token.
      if (!(error instanceof SlackApiError)) throw error;
    }
  }
  throw lastError;
}
