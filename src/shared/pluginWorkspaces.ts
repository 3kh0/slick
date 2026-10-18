export type PluginWorkspaces = Record<string, unknown>;

export const WORKSPACE_ID = /^[TE][A-Z0-9]+$/;

const APP_WIDE: Record<string, string> = {
  AccountSwitcher: 'Account switching manages the shared Slack session.',
  Click2Load: 'Embed blocking applies to the shared Slack session.',
  CustomSounds: 'Native notification sounds apply to the whole app.',
  NoTrack: 'Network tracking protection applies to the shared Slack session.',
  QuietSpotify: 'Embedded audio controls apply to the whole app.',
  ShutUpSlackbot: 'Native notification filtering applies to the whole app.',
  Snappy: 'Startup optimizations apply to the whole app.',
  StreamerMode: 'Streamer mode can silence notifications across the whole app.',
};

export function appWideReason(id: string): string | undefined {
  return Object.hasOwn(APP_WIDE, id) ? APP_WIDE[id] : undefined;
}

export function workspaceSelection(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && WORKSPACE_ID.test(id)))];
}

export function workspaceAllowed(value: unknown, workspaceId: string | null): boolean {
  const selected = workspaceSelection(value);
  return selected === null || (workspaceId !== null && selected.includes(workspaceId));
}

export function workspaceFromPath(pathname: string): string | null {
  const id = /^\/client\/([^/]+)(?:\/|$)/.exec(pathname)?.[1];
  return id && WORKSPACE_ID.test(id) ? id : null;
}
