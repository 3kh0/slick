// Every experiment read goes through Slack's getGroupForUser selectors, which
// look the name up in the `experiments` slice. Overrides are applied as that
// slice is read, so Slack's stored assignments are never touched and turning
// the plugin off restores them.

import { SlickPlugin } from '$slick';
import {
  COMMON_GROUPS,
  NOT_ENROLLED,
  applyOverride,
  buildCatalog,
  isExperimentName,
  matches,
  normalizeQuery,
  sanitizeOverrides,
  scanSource,
  type Assignment,
  type CodeRefs,
  type Experiment,
  type Filter,
  type Overrides,
} from './catalog.ts';
import * as meta from './meta.ts';

const STORAGE_KEY = 'overrides';
const PAGE_SIZE = 100;
const CUSTOM = '@@slick/custom';
const GETTERS = new Set(['getGroupForUser', 'getGroupForUserWithoutExposure', 'getAssignmentByName']);

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All experiments' },
  { value: 'overridden', label: 'Overridden' },
  { value: 'assigned', label: 'Assigned to you' },
  { value: 'unassigned', label: 'Not assigned' },
];

const MUTED: React.CSSProperties = { fontSize: '13px', opacity: 0.7 };
const ACCENT = 'rgb(var(--sk_highlight, 18, 100, 163))';

export default class Experiments extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  overrides!: { get(): Overrides; set(value: Overrides): void; use(): Overrides };
  /** What Slack booted with; anything else may need a reload to show. */
  private booted = '{}';

  async start() {
    const stored = sanitizeOverrides(await this.api.storage.get<unknown>(STORAGE_KEY, {}));
    this.overrides = new this.api.Store<Overrides>(stored);
    this.booted = JSON.stringify(stored);

    this.api.redux.patchSlice<Assignment>(
      'experiments',
      (name, assignment) => applyOverride(assignment, this.overrides.get()[name]),
      () => Object.keys(this.overrides.get()),
    );

    const render = () => <ExperimentsPanel plugin={this} />;
    this.api.settings.addTab({ label: 'Experiments', icon: <FlaskIcon />, render });
  }

  get elements() {
    return this.api.elements;
  }

  get needsReload(): boolean {
    return JSON.stringify(this.overrides.get()) !== this.booted;
  }

  assignments(): Record<string, Assignment | undefined> {
    return this.api.redux.getRawState()?.experiments ?? {};
  }

  setOverride(name: string, group: string | undefined) {
    const next = { ...this.overrides.get() };
    if (group === undefined) delete next[name];
    else next[name] = group;
    this.save(next);
  }

  clearOverrides() {
    this.save({});
  }

  private save(next: Overrides) {
    this.overrides.set(next);
    // Slice patches memoize on the patch version.
    this.api.redux.refresh();
    void this.api.storage.set(STORAGE_KEY, next).then((saved) => saved || this.log('could not save overrides'));
  }

  /** Experiment names in the code Slack has loaded so far, with the groups each is compared against. */
  scanCode(): CodeRefs {
    const refs: CodeRefs = new Map();
    const selectors = this.api.getExport<Record<string, unknown>>((exp: any) => {
      if (!exp || typeof exp !== 'object') return false;
      return Object.values(exp).some((value: any) => GETTERS.has(value?.meta?.name));
    });
    const moduleId = selectors && this.api.findModuleId(selectors);
    if (!selectors || moduleId === undefined) {
      this.log("could not find Slack's experiment selectors; listing assigned experiments only");
      return refs;
    }

    const keys = Object.keys(selectors).filter((key) => GETTERS.has((selectors[key] as any)?.meta?.name));
    for (const [, source] of this.api.moduleSources()) scanSource(source, moduleId, keys, refs);
    return refs;
  }
}

/** Slack's icon set has no flask. Drawn on its 20px grid; native tab icons render at 15px. */
function FlaskIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      width="15"
      height="15"
      aria-hidden="true"
      style={{ display: 'block' }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 2.75h6M8.25 2.75v4.9L3.9 15.1a1.5 1.5 0 0 0 1.3 2.25h9.6a1.5 1.5 0 0 0 1.3-2.25l-4.35-7.45v-4.9" />
      <path d="M5.75 12.25h8.5" />
    </svg>
  );
}

function ExperimentsPanel({ plugin }: { plugin: Experiments }) {
  const overrides = plugin.overrides.use();
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<Filter>('all');
  const [limit, setLimit] = React.useState(PAGE_SIZE);
  const [confirmReset, setConfirmReset] = React.useState(false);
  // Rescanned per visit, so experiments in chunks loaded since then show up.
  const refs = React.useMemo(() => plugin.scanCode(), [plugin]);
  const assignments = plugin.assignments();

  const catalog = React.useMemo(() => buildCatalog(assignments, refs, overrides), [assignments, refs, overrides]);
  const normalized = normalizeQuery(query);
  const shown = catalog.filter((experiment) => matches(experiment, normalized, filter));
  // Lets an experiment from a chunk that hasn't loaded yet be forced by its full name.
  if (filter === 'all' && !shown.length && isExperimentName(normalized)) {
    shown.unshift({ name: normalized, inCode: false, groups: COMMON_GROUPS });
  }

  const overrideCount = Object.keys(overrides).length;
  const { Button } = plugin.elements;

  return (
    <div style={{ paddingBottom: '24px' }}>
      <div
        role="note"
        style={{
          borderLeft: '4px solid rgb(232, 163, 61)',
          background: 'rgba(232, 163, 61, 0.12)',
          borderRadius: '6px',
          padding: '12px 14px',
          marginBottom: '16px',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: '4px' }}>Hold on!</div>
        <div style={{ marginBottom: '4px' }}>
          Experiments are unreleased Slack features. They might not work, or even break your client.
        </div>
        <div>
          Only use experiments if you know what you're doing. If you don't know what an experiment does, ignore it.
        </div>
      </div>

      <div style={{ ...MUTED, marginBottom: '12px' }}>
        {Object.keys(assignments).length.toLocaleString()} assigned to you · {refs.size.toLocaleString()} referenced in
        loaded code · {overrideCount} overridden
      </div>

      {(plugin.needsReload || overrideCount > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
          {plugin.needsReload && (
            <>
              <Button type="primary" size="small" onClick={() => location.reload()}>
                Reload Slack
              </Button>
              <span style={MUTED}>Many experiments require a reload to take effect.</span>
            </>
          )}
          {overrideCount > 0 && (
            <Button
              type="outline"
              size="small"
              onClick={() => {
                if (!confirmReset) return setConfirmReset(true);
                setConfirmReset(false);
                plugin.clearOverrides();
              }}
              onBlur={() => setConfirmReset(false)}
            >
              {confirmReset ? `Clear ${overrideCount} override${overrideCount === 1 ? '' : 's'}?` : 'Reset all'}
            </Button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <input
          className="c-input_text"
          type="search"
          placeholder="Search experiments"
          aria-label="Search experiments"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setLimit(PAGE_SIZE);
          }}
          style={{ flex: '1 1 auto', margin: 0 }}
        />
        <select
          className="c-select_input"
          aria-label="Show"
          value={filter}
          onChange={(event) => {
            setFilter(event.currentTarget.value as Filter);
            setLimit(PAGE_SIZE);
          }}
          style={{ position: 'relative', width: '180px', height: 'auto', flex: '0 0 auto' }}
        >
          {FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {shown.length === 0 && <div style={{ ...MUTED, padding: '16px 0' }}>No experiments match.</div>}
      {shown.slice(0, limit).map((experiment) => (
        <ExperimentRow
          key={experiment.name}
          experiment={experiment}
          onChange={(group) => plugin.setOverride(experiment.name, group)}
        />
      ))}
      {shown.length > limit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '14px' }}>
          <Button size="small" onClick={() => setLimit((value) => value + PAGE_SIZE * 5)}>
            Show more
          </Button>
          <span style={MUTED}>
            Showing {limit.toLocaleString()} of {shown.length.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}

function describe({ assignment, inCode }: Experiment): string {
  const parts = assignment ? [`Assigned ${assignment.group}`] : ['Not assigned'];
  if (assignment?.trigger) parts.push(assignment.trigger);
  if (!inCode) parts.push('not in loaded code');
  return parts.join(' · ');
}

function ExperimentRow({ experiment, onChange }: { experiment: Experiment; onChange: (group?: string) => void }) {
  const { name, assignment, override, groups } = experiment;
  const [custom, setCustom] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const scope = assignment?.type ? assignment.type[0].toUpperCase() + assignment.type.slice(1) : '';

  const choose = (value: string) => {
    if (value === CUSTOM) {
      setCustom(override && override !== NOT_ENROLLED ? override : '');
      setEditing(true);
      return;
    }
    setEditing(false);
    onChange(value === '' ? undefined : value);
  };

  const submitCustom = () => {
    const group = custom.trim();
    setEditing(false);
    if (group) onChange(group.slice(0, 100));
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 0 10px 10px',
        borderTop: '1px solid rgba(127, 127, 127, 0.2)',
        boxShadow: override !== undefined ? `inset 3px 0 0 ${ACCENT}` : undefined,
      }}
    >
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{name}</div>
        <div style={{ ...MUTED, overflowWrap: 'anywhere' }}>{describe(experiment)}</div>
      </div>
      {scope && <span style={{ ...MUTED, flex: '0 0 auto' }}>{scope}</span>}
      {editing ? (
        <input
          className="c-input_text"
          type="text"
          aria-label={`Custom group for ${name}`}
          placeholder="Group name"
          value={custom}
          autoFocus
          onChange={(event) => setCustom(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitCustom();
            if (event.key === 'Escape') {
              event.stopPropagation();
              setEditing(false);
            }
          }}
          onBlur={submitCustom}
          style={{ width: '170px', margin: 0, flex: '0 0 auto' }}
        />
      ) : (
        <select
          className="c-select_input"
          aria-label={`Group for ${name}`}
          value={override ?? ''}
          onChange={(event) => choose(event.currentTarget.value)}
          style={{
            position: 'relative',
            width: '170px',
            height: 'auto',
            flex: '0 0 auto',
            fontWeight: override !== undefined ? 700 : undefined,
            color: override !== undefined ? ACCENT : undefined,
          }}
        >
          <option value="">Default ({assignment?.group ?? 'not enrolled'})</option>
          {groups.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
          <option value={NOT_ENROLLED}>Not enrolled</option>
          <option value={CUSTOM}>Custom…</option>
        </select>
      )}
    </div>
  );
}
