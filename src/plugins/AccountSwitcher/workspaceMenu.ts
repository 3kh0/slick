import type { SavedWorkspace } from './session.ts';

export const SAVED_WORKSPACE_PREFIX = 'slick-saved-workspace__';

// Extend only Slack's native workspace menu; preserve its rows and add action
export function addSavedWorkspaceItems<T extends { key: string | null }>(
  children: T[],
  workspaces: SavedWorkspace[],
  makeItem: (source: T, workspace: SavedWorkspace) => T,
): T[] {
  const index = children.findIndex((child) => child.key === 'team_switcher_add');
  if (index === -1) return children;
  const keys = new Set(children.map((child) => child.key));
  const missing = workspaces.filter(
    (workspace) => !keys.has(workspace.teamId) && !keys.has(`${SAVED_WORKSPACE_PREFIX}${workspace.teamId}`),
  );
  if (!missing.length) return children;
  return [
    ...children.slice(0, index),
    ...missing.map((workspace) => makeItem(children[index]!, workspace)),
    ...children.slice(index),
  ];
}
