import { workspaceFromPath, WORKSPACE_ID } from '../shared/pluginWorkspaces.ts';
import { readLocalConfig } from './slack/localConfig.ts';

export function currentWorkspaceId(): string | null {
  return workspaceFromPath(globalThis.location?.pathname ?? '');
}

export function knownWorkspaces(selected: readonly string[] = []): { id: string; name: string }[] {
  const teams = readLocalConfig()?.teams;
  const names = new Map<string, string>();
  if (teams && typeof teams === 'object') {
    for (const [id, team] of Object.entries(teams)) {
      if (!WORKSPACE_ID.test(id)) continue;
      names.set(id, typeof team?.name === 'string' && team.name ? team.name : id);
    }
  }
  const current = currentWorkspaceId();
  for (const id of [...selected, ...(current ? [current] : [])]) {
    if (!names.has(id)) names.set(id, id);
  }
  return [...names]
    .map(([id, name]) => ({ id, name }))
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function watchWorkspace(onChange: () => void): () => void {
  let previous = currentWorkspaceId();
  const check = () => {
    const next = currentWorkspaceId();
    if (next === previous) return;
    previous = next;
    onChange();
  };
  const restore: (() => void)[] = [];
  if (window.history) {
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = window.history[method];
      const wrapped: typeof original = function (this: History, ...args) {
        original.apply(this, args);
        check();
      };
      window.history[method] = wrapped;
      restore.push(() => {
        if (window.history[method] === wrapped) window.history[method] = original;
      });
    }
  }
  // History hooks and popstate catch navigation; the timer only covers a path change made through a reference taken before the hooks were installed.
  const timer = setInterval(check, 2000);
  window.addEventListener('popstate', check);
  return () => {
    clearInterval(timer);
    window.removeEventListener('popstate', check);
    for (const reset of restore) reset();
  };
}
