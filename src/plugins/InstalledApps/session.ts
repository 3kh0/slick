import type { LocalConfig, LocalConfigTeam } from '../../app/slack/localConfig.ts';

// Enterprise client tokens can be rejected while the same login's workspace token works
export function appSessions(active: LocalConfigTeam | undefined, config: LocalConfig): LocalConfigTeam[] {
  if (!active?.id || !active.user_id || !active.token) return [];
  return [
    active,
    ...Object.values(config.teams ?? {}).filter(
      (team) =>
        team.id !== active.id &&
        team.user_id === active.user_id &&
        team.token &&
        typeof team.enterprise_id === 'string' &&
        team.enterprise_id === active.id,
    ),
  ];
}

export type SessionChoice = { teamId?: string };

export async function sessionRequest<T>(
  sessions: LocalConfigTeam[],
  params: Record<string, string>,
  signal: AbortSignal,
  request: typeof fetch = fetch,
  choice?: SessionChoice,
): Promise<T> {
  let error = 'No active Slack session';
  const preferred = choice?.teamId && sessions.find((team) => team.id === choice.teamId);
  const ordered = preferred ? [preferred, ...sessions.filter((team) => team !== preferred)] : sessions;
  for (const team of ordered) {
    const url = new URL('/api/admin.apps.installed.list?_x_gantry=true', team.url!);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.slack.com')) throw new Error('Invalid Slack host');
    const body = new FormData();
    body.set('token', team.token!);
    for (const [key, value] of Object.entries(params)) body.set(key, value);
    const response = await request(url, { method: 'POST', body, credentials: 'include', redirect: 'error', signal });
    if (!response.ok) throw new Error(`Installed apps HTTP ${response.status}`);
    const result = await response.json();
    if (result.ok) {
      if (choice) choice.teamId = team.id;
      return result as T;
    }
    error = typeof result.error === 'string' ? result.error : 'Invalid Slack response';
    if (!['enterprise_is_restricted', 'missing_scope', 'not_allowed_token_type'].includes(error)) break;
  }
  throw new Error(error);
}
