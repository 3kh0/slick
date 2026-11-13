import { type ChangelogRelease, hasHighlights, HIGHLIGHTS, newerThan } from '../shared/changelog.ts';
import { setStyle } from './api/css.ts';
import { modalReady } from './api/modal.tsx';
import type { SlickBridge } from './bridge.ts';
import type { ConfigStore } from './configStore.ts';
import type { PluginManager } from './pluginManager.ts';
import type { UpdateStatus } from './updateStatus.ts';

const RELEASES_URL = 'https://github.com/3kh0/slick/releases';
const COLLAPSED_ITEMS = 4;
const OPEN_ATTEMPTS = 30;
const OPEN_RETRY_MS = 2000;

const CSS = `
.slick-wn { display: grid; gap: 20px; font-size: 14px; line-height: 20px; color: var(--dt_color-content-pry); }
.slick-wn [data-kind='highlight'] { --wn-accent: #ecb22e; }
.slick-wn [data-kind='new'] { --wn-accent: #2eb67d; }
.slick-wn [data-kind='fixed'] { --wn-accent: #36c5f0; }
.slick-wn [data-kind='other'] { --wn-accent: #9a9a9a; }
.slick-wn code { font-size: 12px; }

.slick-wn__header { display: grid; gap: 2px; }
.slick-wn__headline { font-size: 18px; font-weight: 900; line-height: 24px; }
.slick-wn__sub { color: var(--dt_color-content-sec); }

.slick-wn__section { display: grid; gap: 8px; }
.slick-wn .slick-wn__section-title {
  display: flex; align-items: center; gap: 8px; margin: 0; font-size: 11px; font-weight: 800;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--dt_color-content-sec);
}
.slick-wn__section-title svg { color: var(--wn-accent); }

.slick-wn__highlight {
  position: relative; padding: 12px 14px 12px 40px; border-radius: 8px;
  background: var(--dt_color-surf-ter, rgba(127, 127, 127, 0.1));
  font-size: 15px; font-weight: 700; line-height: 22px;
}
.slick-wn__highlight > svg { position: absolute; top: 15px; left: 14px; color: #ecb22e; }
.slick-wn__highlight .slick-wn__build { position: absolute; top: 13px; right: 12px; }
.slick-wn__highlight:has(> .slick-wn__build) { padding-right: 64px; }

.slick-wn__list { display: grid; gap: 1px; margin: 0; padding: 0; list-style: none; }
.slick-wn__item { display: flex; gap: 10px; align-items: flex-start; padding: 6px 8px; border-radius: 8px; }
.slick-wn__item:hover { background: var(--dt_color-surf-ter, rgba(127, 127, 127, 0.08)); }
.slick-wn__item > svg { flex: none; margin-top: 2px; color: var(--wn-accent); }
.slick-wn__dot { flex: none; width: 7px; height: 7px; margin: 7px 3px 0; border-radius: 50%; background: var(--wn-accent); }
.slick-wn__text { flex: 1; min-width: 0; }
.slick-wn__build {
  flex: none; padding: 0 6px; border: 1px solid var(--dt_color-otl-ter); border-radius: 6px;
  font: 600 11px/18px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dt_color-content-ter);
}
.slick-wn__more {
  justify-self: start; margin-left: 8px; padding: 0; border: 0; background: none; cursor: pointer;
  font: inherit; font-size: 13px; font-weight: 700; color: var(--dt_color-content-hgl-1, #1d9bd1);
}
.slick-wn__more:hover { text-decoration: underline; }

.slick-wn__plugins { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; font-size: 12px; font-weight: 700; }
.slick-wn__plugin {
  display: inline-flex; align-items: center; gap: 8px; height: 26px; padding: 0 4px 0 10px;
  border: 1px solid var(--dt_color-otl-sec); border-radius: 999px; background: var(--dt_color-base-pry);
}
.slick-wn__plugin[data-on='true'] { padding-right: 10px; }
.slick-wn__plugin-state { color: #2eb67d; }
.slick-wn__plugin button {
  height: 20px; padding: 0 10px; border: 0; border-radius: 999px; cursor: pointer;
  font: inherit; font-size: 11px; color: #fff; background: var(--dt_color-base-inv-hgl-1, #1264a3);
}
.slick-wn__plugin button:hover { filter: brightness(1.1); }

.slick-wn__links { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 16px; border-top: 1px solid var(--dt_color-otl-ter); }
.slick-wn > .slick-wn__links { margin-bottom: 24px; }
.slick-settings__section > .slick-wn__links { margin-top: 12px; padding-top: 0; border-top: 0; }
.slick-wn .slick-wn__link {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 8px;
  border: 1px solid var(--dt_color-otl-sec); color: var(--dt_color-content-pry); font-size: 13px; font-weight: 700; text-decoration: none;
}
.slick-wn .slick-wn__link:hover { background: var(--dt_color-surf-ter, rgba(127, 127, 127, 0.1)); text-decoration: none; }

.slick-wn__update { display: grid; gap: 16px; padding: 16px; }
.slick-wn__update-head { display: flex; align-items: center; gap: 14px; }
.slick-wn__update-icon {
  display: grid; place-items: center; flex: none; width: 36px; height: 36px; border-radius: 50%;
  color: #2eb67d; background: color-mix(in srgb, #2eb67d 16%, transparent);
}
.slick-wn__update[data-state='error'] .slick-wn__update-icon { color: #e01e5a; background: color-mix(in srgb, #e01e5a 16%, transparent); }
.slick-wn__update-title { font-size: 16px; font-weight: 800; line-height: 22px; }
.slick-wn__update-sub { color: var(--dt_color-content-sec); font-size: 13px; }
.slick-wn__update-action { margin-left: auto; }
.slick-wn__progress { height: 4px; border-radius: 2px; overflow: hidden; background: color-mix(in srgb, #2eb67d 18%, transparent); }
.slick-wn__progress span { display: block; height: 100%; background: #2eb67d; transition: width 0.2s; }

.slick-wn__release { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; padding: 14px 16px; }
.slick-wn__release + .slick-wn__release { border-top: 1px solid var(--dt_color-otl-ter); }
.slick-wn__release-label { font-size: 14px; font-weight: 800; line-height: 32px; }
.slick-wn__release-label small { display: block; margin-top: -8px; font-size: 12px; font-weight: 600; color: var(--dt_color-content-ter); }
.slick-wn__release .slick-wn__highlight { padding-top: 10px; padding-bottom: 10px; font-size: 14px; }
.slick-wn__release .slick-wn__highlight > svg { top: 12px; left: 14px; }
`;

let styled = false;
function useStyles() {
  if (styled) return;
  styled = true;
  setStyle(CSS, 'whats-new');
}

type Kind = 'highlight' | 'new' | 'fixed' | 'other';
type Entry = { build: number | null; kind: Kind; group: string; text: string };
type IconName = 'star' | 'plus' | 'check' | 'link' | 'down' | 'up' | 'alert';

function kindOf(group: string): Kind {
  const title = group.toLowerCase();
  if (group === HIGHLIGHTS) return 'highlight';
  if (/^(new|added|features?)$/.test(title)) return 'new';
  if (/^(fixed|fixes|bug ?fixes)$/.test(title)) return 'fixed';
  return 'other';
}

function entriesOf(releases: ChangelogRelease[]): Entry[] {
  return releases.flatMap((release) =>
    release.groups.flatMap((group) =>
      group.items.map((text) => ({ build: release.build, kind: kindOf(group.title), group: group.title, text })),
    ),
  );
}

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const stroke = {
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: 'none',
  } as const;
  const paths: Record<IconName, React.ReactNode> = {
    star: (
      <path
        d="M8 1.6l1.95 3.95 4.35.63-3.15 3.07.74 4.33L8 11.53l-3.89 2.05.74-4.33L1.7 6.18l4.35-.63z"
        fill="currentColor"
      />
    ),
    plus: <path d="M8 3v10M3 8h10" {...stroke} />,
    check: <path d="M3 8.5l3.2 3.2L13 4.8" {...stroke} />,
    link: <path d="M6 4h6v6M12 4l-7.5 7.5" {...stroke} />,
    down: <path d="M8 2.5v9M4 8l4 4 4-4" {...stroke} />,
    up: <path d="M8 13.5v-9M4 8l4-4 4 4" {...stroke} />,
    alert: <path d="M8 3.5v5.5M8 12v.5" {...stroke} />,
  };
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const INLINE = /(`[^`]+`|\[[^\]]+\]\(https:\/\/[^)\s]+\))/;

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(INLINE).map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
        const link = /^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/.exec(part);
        if (link) {
          return (
            <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">
              {link[1]}
            </a>
          );
        }
        return part;
      })}
    </>
  );
}

type Plugins = { manager?: PluginManager; config: ConfigStore };

function useLiveState({ manager, config }: Plugins) {
  const [, render] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => config.onConfigChange(render), [config]);
  React.useEffect(() => manager?.onStatusChange(render), [manager]);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text: string, word: string, flags = '') =>
  new RegExp(`(^|[^\\w])${escape(word)}([^\\w]|$)`, flags).test(text);

/** Built-in plugins an entry names, by id (`MessageLogger`) or display name (`Message Logger`). */
function mentionedPlugins(text: string, manager?: PluginManager) {
  if (!manager) return [];
  return manager
    .info()
    .filter(
      (plugin) =>
        !plugin.user && (mentions(text, plugin.name) || (plugin.id.length >= 6 && mentions(text, plugin.id, 'i'))),
    );
}

function PluginChips({ text, manager, config, offOnly = false }: Plugins & { text: string; offOnly?: boolean }) {
  const plugins = mentionedPlugins(text, manager).filter((plugin) => !offOnly || !plugin.enabled);
  if (!plugins.length) return null;
  return (
    <div className="slick-wn__plugins">
      {plugins.map((plugin) => (
        <span key={plugin.id} className="slick-wn__plugin" data-on={String(plugin.enabled)}>
          {plugin.name}
          {plugin.enabled ? (
            <span className="slick-wn__plugin-state">On</span>
          ) : (
            <button type="button" onClick={() => void config.setPluginEnabled(plugin.id, true)}>
              Turn on
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

function BuildTag({ build }: { build: number | null }) {
  return <span className="slick-wn__build">{build ?? 'next'}</span>;
}

type EntryProps = Plugins & { entry: Entry; showBuild: boolean };

function Highlight({ entry, showBuild, ...plugins }: EntryProps) {
  return (
    <div className="slick-wn__highlight">
      <Icon name="star" />
      {showBuild && <BuildTag build={entry.build} />}
      <Inline text={entry.text} />
      <PluginChips text={entry.text} {...plugins} />
    </div>
  );
}

function Item({ entry, showBuild, ...plugins }: EntryProps) {
  return (
    <li className="slick-wn__item" data-kind={entry.kind}>
      <span className="slick-wn__dot" />
      <div className="slick-wn__text">
        <Inline text={entry.text} />
        {entry.kind === 'new' && <PluginChips text={entry.text} offOnly {...plugins} />}
      </div>
      {showBuild && <BuildTag build={entry.build} />}
    </li>
  );
}

type SectionProps = Plugins & { title: string; icon: IconName; kind: Kind; entries: Entry[]; showBuild: boolean };

function Section({ title, icon, kind, entries, showBuild, ...plugins }: SectionProps) {
  const [open, setOpen] = React.useState(false);
  if (!entries.length) return null;
  const collapsible = entries.length > COLLAPSED_ITEMS + 1;
  const shown = collapsible && !open ? entries.slice(0, COLLAPSED_ITEMS) : entries;
  return (
    <section className="slick-wn__section" data-kind={kind}>
      <h4 className="slick-wn__section-title">
        <Icon name={icon} size={14} />
        {title}
      </h4>
      <ul className="slick-wn__list">
        {shown.map((entry, index) => (
          <Item key={`${entry.build}-${index}`} entry={entry} showBuild={showBuild} {...plugins} />
        ))}
      </ul>
      {collapsible && (
        <button type="button" className="slick-wn__more" onClick={() => setOpen(!open)}>
          {open ? 'Show fewer' : `Show ${entries.length - COLLAPSED_ITEMS} more`}
        </button>
      )}
    </section>
  );
}

/** Every change in `releases`, grouped by kind across builds. */
export function ChangeSummary({ releases, ...plugins }: Plugins & { releases: ChangelogRelease[] }) {
  useStyles();
  useLiveState(plugins);
  const entries = entriesOf(releases);
  const showBuild = releases.length > 1;
  const highlights = entries.filter((entry) => entry.kind === 'highlight');
  const others = [...new Set(entries.filter((entry) => entry.kind === 'other').map((entry) => entry.group))];
  const section = (kind: Kind, title: string, icon: IconName, group?: string) => (
    <Section
      key={`${kind}-${group ?? ''}`}
      title={title}
      icon={icon}
      kind={kind}
      entries={entries.filter((entry) => entry.kind === kind && (group === undefined || entry.group === group))}
      showBuild={showBuild}
      {...plugins}
    />
  );
  return (
    <>
      {highlights.length > 0 && (
        <section className="slick-wn__section" data-kind="highlight">
          <h4 className="slick-wn__section-title">
            <Icon name="star" size={14} />
            Highlights
          </h4>
          {highlights.map((entry, index) => (
            <Highlight key={index} entry={entry} showBuild={showBuild} {...plugins} />
          ))}
        </section>
      )}
      {section('new', 'New', 'plus')}
      {section('fixed', 'Fixed', 'check')}
      {others.map((group) => section('other', group || 'Other', 'link', group))}
    </>
  );
}

export function ReleaseLinks({ from, to }: { from?: number; to?: number }) {
  useStyles();
  return (
    <div className="slick-wn slick-wn__links">
      <a className="slick-wn__link" href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
        All releases <Icon name="link" size={14} />
      </a>
      {from && to && from < to ? (
        <a
          className="slick-wn__link"
          href={`https://github.com/3kh0/slick/compare/v${from}...v${to}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Every commit since Build {from} <Icon name="link" size={14} />
        </a>
      ) : null}
    </div>
  );
}

type BodyProps = Plugins & { releases: ChangelogRelease[]; from: number; to: number };

export function WhatsNewBody({ releases, from, to, ...plugins }: BodyProps) {
  useStyles();
  return (
    <div className="slick-wn">
      <ChangeSummary releases={releases} {...plugins} />
      <ReleaseLinks from={from} to={to} />
    </div>
  );
}

function useUpdateStatus(bridge: SlickBridge): UpdateStatus | null {
  const [status, setStatus] = React.useState<UpdateStatus | null>(null);
  React.useEffect(() => {
    if (!bridge.onUpdateStatus || !bridge.getUpdateStatus) return;
    let received = false;
    const off = bridge.onUpdateStatus((next) => {
      received = true;
      setStatus(next);
    });
    void bridge
      .getUpdateStatus()
      .then((next) => {
        if (!received) setStatus(next);
      })
      .catch(() => {});
    return off;
  }, [bridge]);
  return status;
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

type PanelView = { title: string; sub: string; action?: string; icon: IconName };

/** The update waiting for this install and what it brings, or a quiet "up to date". */
export function UpdatePanel({
  bridge,
  Button,
  ...plugins
}: Plugins & { bridge: SlickBridge; Button: React.ComponentType<any> }) {
  useStyles();
  const status = useUpdateStatus(bridge);
  const build = __SLICK_BUILD__;
  const state = bridge.getUpdateStatus ? (status?.state ?? 'idle') : 'idle';
  const coming = newerThan(status?.notes ?? [], build, __SLICK_CHANGELOG__);
  const size = status?.size
    ? `${status.kind === 'code' ? 'Small update' : 'Full download'}, ${megabytes(status.size)}`
    : status?.kind === 'code'
      ? 'Small update'
      : '';
  const updatesBy = bridge.loader === 'extension' ? 'your browser' : 'your userscript manager';
  const views: Record<UpdateStatus['state'], PanelView> = {
    idle: {
      title: "You're up to date",
      sub: bridge.getUpdateStatus
        ? `Build ${build || 'dev'} is the newest. Slick checks for updates every few hours.`
        : `Build ${build || 'dev'}. Updates arrive automatically through ${updatesBy}.`,
      icon: 'check',
    },
    available: {
      title: `Build ${status?.latestBuild} is ready for you`,
      sub: [size, coming.length ? "Here's what you get" : ''].filter(Boolean).join(' · '),
      action: 'Update now',
      icon: 'down',
    },
    downloading: { title: `Getting Build ${status?.latestBuild}`, sub: status?.detail ?? 'Downloading…', icon: 'down' },
    ready: {
      title: `Build ${status?.latestBuild} is installed`,
      sub: 'Restart Slick to start using it, or it applies the next time you quit.',
      action: 'Restart now',
      icon: 'up',
    },
    error: {
      title: "The update didn't finish",
      sub: status?.detail ?? 'Something went wrong.',
      action: 'Try again',
      icon: 'alert',
    },
  };
  const view = views[state];
  const pending = state === 'available' || state === 'downloading' || state === 'ready';
  return (
    <div className="slick-wn slick-wn__update" data-state={state}>
      <div className="slick-wn__update-head">
        <span className="slick-wn__update-icon">
          <Icon name={view.icon} size={20} />
        </span>
        <div>
          <div className="slick-wn__update-title">{view.title}</div>
          <div className="slick-wn__update-sub">{view.sub}</div>
        </div>
        {view.action && (
          <div className="slick-wn__update-action">
            <Button type="primary" size="small" onClick={() => void bridge.activateUpdate?.().catch(console.error)}>
              {view.action}
            </Button>
          </div>
        )}
      </div>
      {state === 'downloading' && (
        <div className="slick-wn__progress">
          <span style={{ width: `${status?.percent ?? 15}%` }} />
        </div>
      )}
      {pending && coming.length > 0 && <ChangeSummary releases={coming} {...plugins} />}
    </div>
  );
}

/** Recent builds, newest first, one row each. */
export function ReleaseTimeline({ releases, ...plugins }: Plugins & { releases: ChangelogRelease[] }) {
  useStyles();
  useLiveState(plugins);
  return (
    <div className="slick-wn" style={{ gap: 0 }}>
      {releases.map((release) => {
        const entries = entriesOf([release]);
        const highlights = entries.filter((entry) => entry.kind === 'highlight');
        const rest = entries.filter((entry) => entry.kind !== 'highlight');
        return (
          <div key={release.build ?? 'next'} className="slick-wn__release">
            <div className="slick-wn__release-label">
              {release.build === null ? 'Unreleased' : `Build ${release.build}`}
              {release.build === __SLICK_BUILD__ && <small>You're here</small>}
            </div>
            <div className="slick-wn__section">
              {highlights.map((entry, index) => (
                <Highlight key={index} entry={entry} showBuild={false} {...plugins} />
              ))}
              {rest.length > 0 && (
                <ul className="slick-wn__list">
                  {rest.map((entry, index) => (
                    <Item key={index} entry={entry} showBuild={false} {...plugins} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function releasesBetween(changelog: ChangelogRelease[], after: number, upTo: number): ChangelogRelease[] {
  return changelog.filter((r) => r.build !== null && r.build > after && r.build <= upTo);
}

/** Opens What's new once per update, and only when a skipped-over build has highlights. */
export async function showWhatsNew(
  config: ConfigStore,
  manager?: PluginManager,
  build = __SLICK_BUILD__,
  changelog = __SLICK_CHANGELOG__,
): Promise<boolean> {
  if (!build || config.lastSeenBuild === build) return false;
  // Decided inside the write so only one tab sharing these settings opens it.
  let seen: number | undefined = build;
  const saved = await config.update((stored) => {
    seen = typeof stored.lastSeenBuild === 'number' ? stored.lastSeenBuild : undefined;
    stored.lastSeenBuild = build;
  });
  if (!saved || seen === undefined || seen >= build) return false;
  const from = seen;
  const fresh = releasesBetween(changelog, from, build);
  if (!config.whatsNewPopup || !hasHighlights(fresh)) return false;
  const { openModal } = await modalReady;
  // Slack's openModal thunk is found after the modal API resolves; keep trying until it is.
  for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, OPEN_RETRY_MS));
    const handle = openModal({
      title: "What's new in Slick",
      body: <WhatsNewBody releases={fresh} from={from} to={build} manager={manager} config={config} />,
      submitText: 'Nice, thanks',
      showCancelButton: false,
    });
    if (handle) return true;
  }
  return false;
}
