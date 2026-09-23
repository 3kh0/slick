// Pure logic for Experiments: finding experiment names in Slack's code, merging
// them with the server's assignments, and rewriting an assignment for an override.

/** One entry of Slack's `experiments` slice, as the server assigns it. */
export type Assignment = {
  experiment_id?: string;
  type?: string;
  group?: string;
  trigger?: string;
  log_exposures?: boolean;
  exposure_id?: string | number;
  schedule_ts?: number;
};

export type Overrides = Record<string, string>;

export type CodeRefs = Map<string, Set<string>>;

export type Experiment = {
  name: string;
  assignment?: Assignment;
  override?: string;
  inCode: boolean;
  /** Groups worth offering: from code first, then the assigned one, then the usual ones. */
  groups: string[];
};

export type Filter = 'all' | 'overridden' | 'assigned' | 'unassigned';

/** Override value that removes the assignment, as if the server never sent one. */
export const NOT_ENROLLED = '@@slick/not-enrolled';

export const COMMON_GROUPS = ['on', 'off', 'control', 'treatment'];

const NAME = /^[\w.-]{1,120}$/;
const MAX_GROUP = 100;

export const isExperimentName = (value: string): boolean => NAME.test(value);

const escape = (value: string) => value.replace(/[$.*+?^()[\]{}|\\/]/g, '\\$&');

/**
 * Record every `(0,alias.getter)(state,"name")` call in one module's source,
 * with any `"group"===` comparison on either side. `getterModule` is the id of
 * the module exporting Slack's experiment selectors, `getterKeys` their
 * (minified) export names.
 */
export function scanSource(source: string, getterModule: string, getterKeys: string[], refs: CodeRefs): void {
  if (!getterKeys.length) return;
  const id = escape(getterModule);
  const imports = source.matchAll(new RegExp(`([\\w$]+)=[\\w$]+\\((?:"${id}"|${id})\\)`, 'g'));
  const aliases = [...new Set(Array.from(imports, (match) => match[1]))];
  if (!aliases.length) return;

  const alias = aliases.map(escape).join('|');
  const keys = getterKeys.map(escape).join('|');
  const compare = String.raw`"([^"\\]{1,80})"\s*[!=]==?\s*`;
  const call = String.raw`\(0,(?:${alias})\.(?:${keys})\)\([^,()]{1,40},"([\w.-]{1,120})"(?:,[^()]{0,20})?\)`;
  const pattern = new RegExp(`(?:${compare})?${call}(?:\\s*[!=]==?\\s*"([^"\\\\]{1,80})")?`, 'g');

  for (const match of source.matchAll(pattern)) {
    const [, before, name, after] = match;
    let groups = refs.get(name);
    if (!groups) refs.set(name, (groups = new Set()));
    if (before) groups.add(before);
    if (after) groups.add(after);
  }
}

/**
 * The assignment Slack should see under an override: the server's with the
 * group swapped, or a synthetic one for an experiment it never assigned.
 * Exposure logging is off so a forced group isn't reported as a real one.
 */
export function applyOverride(assignment: Assignment | undefined, group: string | undefined): Assignment | undefined {
  if (group === undefined) return assignment;
  if (group === NOT_ENROLLED) return undefined;
  // Same defaults as Slack's own overrideExperimentAssignments action.
  const base = assignment ?? { experiment_id: 'from-override', type: 'user', exposure_id: 0, trigger: 'force_request' };
  return { ...base, group, log_exposures: false };
}

export function sanitizeOverrides(value: unknown): Overrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Overrides = {};
  for (const [name, group] of Object.entries(value as Record<string, unknown>)) {
    if (!isExperimentName(name) || typeof group !== 'string' || !group || group.length > MAX_GROUP) continue;
    out[name] = group;
  }
  return out;
}

function groupsFor(codeGroups: Iterable<string> | undefined, assigned: string | undefined, override?: string) {
  const groups = new Set<string>(codeGroups);
  if (assigned) groups.add(assigned);
  if (override && override !== NOT_ENROLLED) groups.add(override);
  for (const group of COMMON_GROUPS) groups.add(group);
  return [...groups];
}

export function buildCatalog(
  assigned: Record<string, Assignment | undefined>,
  refs: CodeRefs,
  overrides: Overrides,
): Experiment[] {
  const names = new Set([...Object.keys(assigned), ...refs.keys(), ...Object.keys(overrides)]);
  const catalog: Experiment[] = [];
  for (const name of names) {
    const assignment = assigned[name];
    catalog.push({
      name,
      assignment,
      override: overrides[name],
      inCode: refs.has(name),
      groups: groupsFor(refs.get(name), assignment?.group, overrides[name]),
    });
  }
  return catalog.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, '_');
}

export function matches(experiment: Experiment, query: string, filter: Filter): boolean {
  if (filter === 'overridden' && experiment.override === undefined) return false;
  if (filter === 'assigned' && !experiment.assignment) return false;
  if (filter === 'unassigned' && experiment.assignment) return false;
  return !query || experiment.name.includes(query);
}
