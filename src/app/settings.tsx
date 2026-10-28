import type { PluginCategory, ScheduleRule, Setting, SettingValue } from '../shared/settings.ts';
import { coerceSetting, PLUGIN_CATEGORIES } from '../shared/settings.ts';
import { fileLabel } from './api/storedFiles.ts';
import { modalReady, type ModalHandle } from './api/modal.tsx';
import { elementsReady } from './api/elements.ts';
import { setStyle } from './api/css.ts';
import { settingsTabs, type SettingsTab } from './api/settingsTabs.ts';
import type { SlickBridge } from './bridge.ts';
import type { ConfigStore } from './configStore.ts';
import type { PluginManager } from './pluginManager.ts';
import { patchComponent, reactReady } from './slack/react.tsx';
import { dispatchThunk } from './slack/redux.ts';
import { Store } from './store.ts';
import type { ThemeJson } from './theme.ts';
import { parseThemeJson } from '../shared/themes.ts';
import { currentWorkspaceId, knownWorkspaces } from './workspaces.ts';
import { HACK_CLUB_PATH } from '../shared/icons.ts';
import slickMark from '../../assets/desktop.svg';

let elements: Awaited<typeof elementsReady>;
let warnedUnrecognisedTabs = false;
const configWriteQueues = new WeakMap<ConfigStore, Promise<void>>();
const requestedTab = new Store<string | null>(null);

/**
 * Preferences section ids (Slack 4.52.155). The
 * sidebar rail uses the same `Tabs` component with disjoint ids, so the
 * Preferences list is identified by several matches from this set.
 */
const PREFERENCES_TAB_IDS = new Set([
  'availability',
  'notifications',
  'vip',
  'tab_rail',
  'sidebar',
  'themes',
  'messages_media',
  'language_region',
  'accessibility',
  'mark_as_read',
  'video_audio',
  'salesforce',
  'connected_accounts',
  'privacy_visibility',
  'advanced',
  'slack_ai',
  'labs',
  'send_on_behalf',
]);

// Widens Preferences, lets its tab list scroll rather than collapse, and styles the Slick tabs.
const PREFERENCES_CSS = `
.p-prefs_dialog .p-prefs_dialog__modal {
  width: min(1200px, calc(100vw - 64px)) !important;
  max-width: none !important;
  height: min(1000px, calc(100vh - 64px)) !important;
}
.p-prefs_dialog .p-prefs_dialog__tabs { min-height: 0; }
.p-prefs_dialog .p-prefs_dialog__menu {
  max-height: 100%;
  overflow-y: auto;
  flex-shrink: 0;
}
.p-prefs_dialog__menu > #slick {
  position: relative;
  margin-top: 17px;
  overflow: visible;
}
.p-prefs_dialog__menu > #slick::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  border-top: 1px solid var(--dt_color-otl-ter);
  pointer-events: none;
}
.slick-settings {
  padding-bottom: 24px;
  color: var(--dt_color-content-pry);
}
.slick-settings__icon {
  display: inline-flex;
  flex: none;
}
.slick-settings__hint {
  font-size: 13px;
  line-height: 18px;
  color: var(--dt_color-content-sec);
}
.slick-settings__hint:empty {
  display: none;
}
.slick-settings__hero {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}
.slick-settings__logo {
  display: grid;
  place-items: center;
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  border: 1px solid var(--dt_color-otl-ter);
  background: var(--dt_color-surf-pry, rgba(127, 127, 127, 0.12));
}
.slick-settings__mark {
  display: block;
  flex: none;
  width: 15px;
  height: 15px;
  background: currentColor;
  mask: url(${JSON.stringify(slickMark)}) center / 13px no-repeat;
}
.slick-settings__logo .slick-settings__mark {
  width: 30px;
  height: 30px;
  mask-size: contain;
}
.slick-settings .slick-settings__title {
  margin: 0;
  font-size: 22px;
  font-weight: 900;
  line-height: 28px;
}
.slick-settings__subtitle {
  font-size: 14px;
  color: var(--dt_color-content-sec);
}
.slick-settings__section {
  margin-bottom: 24px;
}
.slick-settings__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 28px;
  margin: 0 2px 8px;
}
.slick-settings .slick-settings__section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}
.slick-settings__section-title .slick-settings__icon,
.slick-settings__section-count {
  color: var(--dt_color-content-ter);
}
.slick-settings__section-count {
  font-size: 13px;
}
.slick-settings__card {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--dt_color-otl-ter);
  border-radius: 12px;
  overflow: hidden;
}
.slick-settings__card > * + * {
  border-top: 1px solid var(--dt_color-otl-ter);
}
.slick-settings__fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.slick-settings__fieldset > * + * {
  border-top: 1px solid var(--dt_color-otl-ter);
}
.slick-settings__toolbar {
  position: sticky;
  top: -20px;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: -20px 0 20px;
  padding: 22px 0 10px;
  background: var(--dt_color-base-pry);
}
.slick-settings__search {
  position: relative;
  flex: 1 1 220px;
}
.slick-settings__search .slick-settings__icon {
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  color: var(--dt_color-content-ter);
  pointer-events: none;
}
.slick-settings__search .c-input_text {
  width: 100%;
  margin: 0;
  padding-left: 34px;
}
.slick-settings__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.slick-settings__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--dt_color-otl-sec);
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 700;
  color: var(--dt_color-content-sec);
  cursor: pointer;
}
.slick-settings__chip:hover {
  border-color: var(--dt_color-otl-pry);
  color: var(--dt_color-content-pry);
}
.slick-settings__chip[aria-pressed='true'] {
  border-color: var(--dt_color-base-inv-hgl-1, #1264a3);
  background: var(--dt_color-base-inv-hgl-1, #1264a3);
  color: #fff;
}
.slick-settings__chip-count {
  font-weight: 400;
  opacity: 0.75;
}
.slick-settings__row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 0;
  padding: 12px 12px 12px 16px;
  cursor: pointer;
}
.slick-settings__row:hover {
  background: var(--dt_color-base-pry-hover, rgba(127, 127, 127, 0.08));
}
.slick-settings__row-text {
  flex: 1 1 auto;
  min-width: 0;
}
.slick-settings__row-name {
  font-size: 15px;
  font-weight: 700;
  line-height: 22px;
  text-align: left;
  cursor: pointer;
}
.slick-settings__row-description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-size: 13px;
  line-height: 18px;
  color: var(--dt_color-content-sec);
}
.slick-settings__chevron {
  display: inline-flex;
  flex: none;
  color: var(--dt_color-content-ter);
}
.slick-settings__switch {
  flex: none;
}
.slick-settings__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  margin-left: 8px;
  padding: 0 8px;
  border-radius: 9999px;
  vertical-align: 2px;
  font-size: 11px;
  font-weight: 700;
  color: var(--dt_color-content-sec);
  background: var(--dt_color-surf-pry, rgba(127, 127, 127, 0.12));
}
.slick-settings__meta .slick-settings__badge {
  margin-left: 0;
}
.slick-settings__badge--warn {
  color: var(--dt_color-content-imp, #e01e5a);
}
.slick-settings__status {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 700;
  color: var(--dt_color-content-ter);
}
.slick-settings__status--error {
  color: var(--dt_color-content-imp, #e01e5a);
}
.slick-settings__notice {
  margin: 0 0 20px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 18px;
  color: var(--dt_color-content-sec);
  background: var(--dt_color-surf-pry, rgba(127, 127, 127, 0.12));
}
.slick-settings__notice--error {
  color: var(--dt_color-content-imp, #e01e5a);
  background: var(--dt_color-base-imp, rgba(224, 30, 90, 0.1));
}
.slick-settings__empty {
  padding: 32px 16px;
  border: 1px dashed var(--dt_color-otl-sec);
  border-radius: 12px;
  text-align: center;
  color: var(--dt_color-content-sec);
}
.slick-settings__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 16px;
  font-weight: 700;
  color: var(--dt_color-content-hgl-1, #1264a3);
  cursor: pointer;
}
.slick-settings__back:hover {
  text-decoration: underline;
}
.slick-settings__detail-head {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 24px;
}
.slick-settings__detail-text {
  flex: 1 1 auto;
  min-width: 0;
}
.slick-settings .slick-settings__detail-title {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 900;
  line-height: 28px;
}
.slick-settings__detail-description {
  font-size: 15px;
  line-height: 22px;
  color: var(--dt_color-content-sec);
}
.slick-settings__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin-top: 10px;
  font-size: 13px;
  color: var(--dt_color-content-ter);
}
.slick-settings__field {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
}
.slick-settings__field--stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}
.slick-settings__field-text {
  flex: 1 1 auto;
  min-width: 0;
}
.slick-settings__field-label {
  display: block;
  margin: 0;
  font-weight: 700;
  line-height: 22px;
}
.slick-settings__field-description {
  font-size: 13px;
  line-height: 18px;
  color: var(--dt_color-content-sec);
  overflow-wrap: anywhere;
}
.slick-settings__field-control {
  flex: none;
  max-width: 100%;
}
.slick-settings__field-control .c-input_text {
  margin: 0;
}
.slick-settings__inline {
  display: flex;
  align-items: center;
  gap: 8px;
}
.slick-settings__inline > .c-input_text {
  flex: 1 1 auto;
  min-width: 0;
}
.slick-settings__value {
  font-variant-numeric: tabular-nums;
  color: var(--dt_color-content-sec);
}
.slick-settings__color {
  width: 44px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--dt_color-otl-sec);
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
.slick-settings__themes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}
.slick-settings__theme {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--dt_color-otl-ter);
  border-radius: 12px;
  cursor: pointer;
  outline: none;
}
.slick-settings__theme:hover {
  border-color: var(--dt_color-otl-pry);
}
.slick-settings__theme:focus-visible,
.slick-settings__theme[aria-checked='true'] {
  border-color: var(--dt_color-otl-hgl-1, #1264a3);
  box-shadow: 0 0 0 1px var(--dt_color-otl-hgl-1, #1264a3);
}
.slick-settings__theme-preview {
  display: flex;
  height: 88px;
  border-bottom: 1px solid var(--dt_color-otl-ter);
}
.slick-settings__theme-preview--css {
  align-items: center;
  justify-content: center;
  color: var(--dt_color-content-ter);
  background: var(--dt_color-surf-pry, rgba(127, 127, 127, 0.12));
}
.slick-settings__theme-sidebar,
.slick-settings__theme-main {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 14px 10px;
}
.slick-settings__theme-sidebar {
  width: 32%;
}
.slick-settings__theme-main {
  flex: 1;
}
.slick-settings__theme-sidebar > span,
.slick-settings__theme-main > span {
  height: 6px;
  border-radius: 3px;
  opacity: 0.55;
}
.slick-settings__theme-text {
  padding: 10px 12px 12px;
}
.slick-settings__theme-name {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-weight: 700;
}
.slick-settings__theme-check {
  display: inline-flex;
  color: var(--dt_color-content-hgl-1, #1264a3);
}
.slick-settings__theme-description {
  overflow: hidden;
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--dt_color-content-sec);
}
.slick-settings__theme-remove {
  position: absolute;
  top: 6px;
  right: 6px;
  display: none;
  padding: 4px;
  border-radius: 6px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  cursor: pointer;
}
.slick-settings__theme:hover .slick-settings__theme-remove,
.slick-settings__theme-remove:focus-visible {
  display: inline-flex;
}
`;

/** Enough matches to be sure, few enough to survive Slack dropping sections. */
const MIN_PREFERENCES_TABS = 3;

function queueConfigWrite(config: ConfigStore, write: () => Promise<boolean>): void {
  const previous = configWriteQueues.get(config) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(write)
    .then(() => {});
  configWriteQueues.set(config, next);
}

type TabsProps = {
  tabs: {
    id?: string;
    label: React.ReactElement;
    content: React.ReactElement;
    svgIcon?: { name: string };
    customIcon?: React.ReactElement;
    'aria-label'?: string;
  }[];
  onTabChange?: (id: string, event: React.UIEvent) => void;
  currentTabId?: string;
  collapsible?: boolean;
};

type PluginInfo = ReturnType<PluginManager['info']>[number];

export async function addSettingsTab(manager: PluginManager, config: ConfigStore, bridge: SlickBridge) {
  await reactReady;
  elements = await elementsReady;
  setStyle(PREFERENCES_CSS, 'core:preferences');

  if (bridge.onOpenSettings) {
    const { openModal } = await modalReady;
    let settingsModal: ModalHandle | null = null;
    bridge.onOpenSettings(() => {
      requestedTab.set('slick_plugins');
      dispatchThunk('openPrefsModal', { activeSection: 'advanced' }).catch((error) => {
        console.error('[slick] could not open Preferences:', error);
        requestedTab.set(null);
        if (settingsModal) return;
        settingsModal = openModal({
          title: 'Slick Plugins',
          body: (
            <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <PluginsPanel manager={manager} config={config} bridge={bridge} />
            </div>
          ),
          submitText: 'Close',
          showCancelButton: false,
          onClose: () => {
            settingsModal = null;
          },
          onSubmit: () => {
            settingsModal = null;
          },
        });
      });
    });
  }

  // Adapted from Taut's MIT-licensed settings tab. Keeping Slack on its real
  // Advanced route avoids teaching its Preferences router an unknown route.
  patchComponent<TabsProps>('Tabs', (Original) => (props) => {
    const [selected, setSelected] = React.useState<string | null>(requestedTab.get);
    const pluginTabs = settingsTabs.use();
    const requested = requestedTab.use();

    const known = props.tabs.filter((tab) => tab.id !== undefined && PREFERENCES_TAB_IDS.has(tab.id));
    const isPreferences = known.length >= MIN_PREFERENCES_TABS;
    React.useEffect(() => {
      if (!isPreferences || !requested) return;
      setSelected(requested);
      requestedTab.set(null);
    }, [isPreferences, requested]);

    if (!isPreferences) {
      // A few matches but not enough: the set above is stale. Warn once rather
      // than silently losing the Slick tab.
      if (known.length && !warnedUnrecognisedTabs) {
        warnedUnrecognisedTabs = true;
        console.error(
          '[slick] Slack Preferences tab ids have changed; the Slick tab has nowhere to go. Saw:',
          props.tabs.map((tab) => tab.id),
        );
      }
      return <Original {...props} />;
    }

    const tabs = [...props.tabs];
    const advanced = tabs.find((tab) => tab.id === 'advanced');
    const hostTab = advanced ?? known[known.length - 1];
    const hostIcon = hostTab.svgIcon ?? { name: 'settings' };
    const injected = new Set<string>();
    const inject = (id: string, label: string, content: React.ReactElement, icon: SettingsTab['icon'] = undefined) => {
      injected.add(id);
      if (tabs.some((tab) => tab.id === id)) return;
      const iconProps =
        typeof icon === 'string' ? { svgIcon: { name: icon } } : icon ? { customIcon: icon } : { svgIcon: hostIcon };
      tabs.push({ id, label: <>{label}</>, content, ...iconProps, 'aria-label': label });
    };
    inject('slick', 'Slick', <OverviewPanel manager={manager} config={config} bridge={bridge} />, <SlickMark />);
    inject('slick_plugins', 'Plugins', <PluginsPanel manager={manager} config={config} bridge={bridge} />, 'apps');
    inject('slick_themes', 'Themes', <ThemesPanel config={config} bridge={bridge} />, 'paintbrush');
    if (manager.supportsUserPlugins)
      inject('slick_install', 'Install plugins', <InstallPlugin manager={manager} />, 'download');
    for (const tab of pluginTabs) inject(tab.id, tab.label, <tab.render />, tab.icon);

    const onTabChange = (id: string, event: React.UIEvent) => {
      setSelected(injected.has(id) ? id : null);
      props.onTabChange?.(injected.has(id) ? (hostTab.id ?? 'advanced') : id, event);
    };

    return (
      <Original
        {...props}
        tabs={tabs}
        currentTabId={selected && injected.has(selected) ? selected : props.currentTabId}
        onTabChange={onTabChange}
        // Otherwise tabs that don't fit collapse into a "More" menu; PREFERENCES_CSS scrolls the list instead.
        collapsible={false}
      />
    );
  });
}

function useConfigChanges(config: ConfigStore) {
  const [, render] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => config.onConfigChange(render), [config]);
}

function useManagerChanges(manager: PluginManager) {
  const [, render] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => manager.onStatusChange(render), [manager]);
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="slick-settings__hint">{children}</div>;
}

function SlickMark() {
  return <span className="slick-settings__mark" aria-hidden="true" />;
}

function Icon({ name: Name }: { name: string | React.ComponentType }) {
  return (
    <span className="slick-settings__icon" aria-hidden="true">
      {typeof Name === 'string' ? <elements.SvgIcon name={Name} size={16} inline /> : <Name />}
    </span>
  );
}

function HackClubIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="16" height="16" style={{ display: 'block' }}>
      <path
        d={HACK_CLUB_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Switch({
  id,
  checked,
  label,
  onChange,
  describedBy,
}: {
  id?: string;
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  describedBy?: string;
}) {
  return (
    // Slack's own switch styles; its React Switch has an unverified prop shape.
    <span className="c-switch c-switch--small slick-settings__switch" onClick={(event) => event.stopPropagation()}>
      <input
        id={id}
        className="c-switch__input"
        type="checkbox"
        role="switch"
        checked={checked}
        aria-label={label}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="c-switch__visual" />
    </span>
  );
}

function Card({ title, action, children }: { title?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="slick-settings__section">
      {(title || action) && (
        <div className="slick-settings__section-head">
          {title && <h3 className="slick-settings__section-title">{title}</h3>}
          {action}
        </div>
      )}
      <div className="slick-settings__card">{children}</div>
    </section>
  );
}

function Field({
  label,
  description,
  htmlFor,
  stacked = false,
  children,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  stacked?: boolean;
  children?: React.ReactNode;
}) {
  const Label = htmlFor ? 'label' : 'div';
  return (
    <div className={`slick-settings__field${stacked ? ' slick-settings__field--stacked' : ''}`}>
      <div className="slick-settings__field-text">
        <Label className="slick-settings__field-label" htmlFor={htmlFor}>
          {label}
        </Label>
        {description && <div className="slick-settings__field-description">{description}</div>}
      </div>
      {children && <div className="slick-settings__field-control">{children}</div>}
    </div>
  );
}

type Filter = 'all' | 'on' | 'off' | 'user' | 'problems';

const CATEGORY_ICONS: Record<PluginCategory, string | React.ComponentType> = {
  messages: 'message',
  composer: 'compose',
  people: 'user',
  channels: 'channel',
  sounds: 'headphones',
  privacy: 'lock',
  appearance: 'paintbrush',
  app: 'settings',
  hackclub: HackClubIcon,
};

function categoryOf(info: PluginInfo): PluginCategory | null {
  return info.category && Object.hasOwn(PLUGIN_CATEGORIES, info.category) ? info.category : null;
}

function categoryLabel(info: PluginInfo): string {
  const category = categoryOf(info);
  return category ? PLUGIN_CATEGORIES[category] : info.user ? 'User plugins' : 'Other';
}

function scrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let parent = node?.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

function OverviewPanel({
  manager,
  config,
  bridge,
}: {
  manager: PluginManager;
  config: ConfigStore;
  bridge: SlickBridge;
}) {
  useConfigChanges(config);
  useManagerChanges(manager);
  const plugins = manager.info();
  const enabled = plugins.filter((info) => info.enabled).length;
  const failing = plugins.filter((info) => info.enabled && info.startError);
  const loaders = { electron: 'Desktop app', extension: 'Browser extension', userscript: 'Userscript' };
  return (
    <div className="slick-settings">
      <header className="slick-settings__hero">
        <div className="slick-settings__logo" aria-hidden="true">
          <SlickMark />
        </div>
        <div>
          <h2 className="slick-settings__title">Slick</h2>
          <div className="slick-settings__subtitle">
            {config.globallyEnabled ? `${enabled} of ${plugins.length} plugins on` : 'Paused: no plugins are running'}
          </div>
        </div>
      </header>
      {failing.length > 0 && (
        <div role="alert" className="slick-settings__notice slick-settings__notice--error">
          {failing.map((info) => info.name).join(', ')} could not start. Open them under Plugins to see why.
        </div>
      )}
      <Card title="Version">
        <Field label="Slick" description={`Build ${__SLICK_BUILD__}`}>
          <span className="slick-settings__value">{__SLICK_VERSION__}</span>
        </Field>
        <Field label={loaders[bridge.loader] ?? bridge.loader} description="How Slick is loaded into Slack">
          <span className="slick-settings__value">{bridge.loaderVersion}</span>
        </Field>
      </Card>
      <Card title="Links">
        <Field label="Source code" description="Slick is open source. Drop a star if you like it!">
          <elements.Button type="outline" size="small" onClick={() => openLink('https://github.com/3kh0/slick')}>
            GitHub
          </elements.Button>
        </Field>
        <Field label="Report a problem" description="Bugs, broken plugins and ideas">
          <elements.Button type="outline" size="small" onClick={() => openLink('https://github.com/3kh0/slick/issues')}>
            Open an issue
          </elements.Button>
        </Field>
      </Card>
    </div>
  );
}

function PluginsPanel({
  manager,
  config,
  bridge,
}: {
  manager: PluginManager;
  config: ConfigStore;
  bridge: SlickBridge;
}) {
  useConfigChanges(config);
  useManagerChanges(manager);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<Filter>('all');
  const root = React.useRef<HTMLDivElement>(null);
  const listScroll = React.useRef(0);

  const open = (id: string | null) => {
    const scroller = scrollParent(root.current);
    if (scroller && openId === null) listScroll.current = scroller.scrollTop;
    setOpenId(id);
  };
  React.useLayoutEffect(() => {
    const scroller = scrollParent(root.current);
    if (scroller) scroller.scrollTop = openId === null ? listScroll.current : 0;
  }, [openId]);

  const plugins = manager.info();
  return (
    <div className="slick-settings" ref={root}>
      {openId === null ? (
        <PluginList
          plugins={plugins}
          config={config}
          query={query}
          setQuery={setQuery}
          filter={filter}
          setFilter={setFilter}
          onOpen={open}
        />
      ) : (
        <PluginDetail
          id={openId}
          plugins={plugins}
          config={config}
          bridge={bridge}
          manager={manager}
          onBack={() => open(null)}
        />
      )}
      {openId === null && !manager.supportsUserPlugins && (
        <Hint>
          {bridge.loader === 'extension'
            ? 'Install plugin files from the Slick toolbar button (not in the Firefox Add-ons version).'
            : 'Install a plugin’s .user.js file in your userscript manager.'}
        </Hint>
      )}
    </div>
  );
}

function pluginProblem(info: PluginInfo, config: ConfigStore): string | null {
  if (!info.enabled || info.running) return null;
  if (!info.workspaceAllowed) return 'Not enabled in this workspace';
  if (!config.globallyEnabled) return 'Slick is paused';
  if (info.startError) return `Could not start: ${info.startError}`;
  return 'Starting…';
}

function PluginList({
  plugins,
  config,
  query,
  setQuery,
  filter,
  setFilter,
  onOpen,
}: {
  plugins: PluginInfo[];
  config: ConfigStore;
  query: string;
  setQuery: (query: string) => void;
  filter: Filter;
  setFilter: (filter: Filter) => void;
  onOpen: (id: string) => void;
}) {
  const failing = plugins.filter((info) => info.startError && info.enabled);
  const filters: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: plugins.length },
    { id: 'on', label: 'On', count: plugins.filter((info) => info.enabled).length },
    { id: 'off', label: 'Off', count: plugins.filter((info) => !info.enabled).length },
    { id: 'user', label: 'User plugins', count: plugins.filter((info) => info.user).length },
    { id: 'problems', label: 'Problems', count: failing.length },
  ];
  const visibleFilters = filters.filter((option) => (option.id !== 'user' && option.id !== 'problems') || option.count);
  const active = visibleFilters.some((option) => option.id === filter) ? filter : 'all';

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = plugins.filter((info) => {
    if (active === 'on' && !info.enabled) return false;
    if (active === 'off' && info.enabled) return false;
    if (active === 'user' && !info.user) return false;
    if (active === 'problems' && !failing.includes(info)) return false;
    const haystack = [info.id, info.name, info.description, info.authors, categoryLabel(info)].join(' ').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });

  const order = [...Object.values(PLUGIN_CATEGORIES), 'User plugins', 'Other'] as string[];
  const groups = new Map<string, PluginInfo[]>();
  for (const info of shown.toSorted((a, b) => a.name.localeCompare(b.name))) {
    const label = categoryLabel(info);
    groups.set(label, [...(groups.get(label) ?? []), info]);
  }
  const ordered = [...groups].toSorted(([a], [b]) => order.indexOf(a) - order.indexOf(b));

  return (
    <div>
      <div className="slick-settings__toolbar">
        <div className="slick-settings__search">
          <Icon name="search" />
          <input
            className="c-input_text"
            type="search"
            placeholder="Search plugins"
            aria-label="Search plugins"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.stopPropagation();
                setQuery('');
              }
            }}
          />
        </div>
        <div className="slick-settings__chips" role="group" aria-label="Filter plugins">
          {visibleFilters.map((option) => (
            <button
              key={option.id}
              type="button"
              className="c-button-unstyled slick-settings__chip"
              aria-pressed={active === option.id}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
              <span className="slick-settings__chip-count">{option.count}</span>
            </button>
          ))}
        </div>
      </div>
      {!ordered.length && (
        <div className="slick-settings__empty">
          {query.trim() ? `No plugins match “${query.trim()}”.` : 'No plugins in this view.'}
        </div>
      )}
      {ordered.map(([label, infos]) => {
        const category = categoryOf(infos[0]);
        const on = infos.filter((info) => info.enabled).length;
        return (
          <section key={label} className="slick-settings__section">
            <div className="slick-settings__section-head">
              <h3 className="slick-settings__section-title">
                <Icon name={category ? CATEGORY_ICONS[category] : 'code'} />
                {label}
              </h3>
              <span className="slick-settings__section-count">{on ? `${on} on` : ''}</span>
            </div>
            <ul className="slick-settings__card slick-settings__list">
              {infos.map((info) => (
                <PluginRow key={info.id} info={info} config={config} onOpen={() => onOpen(info.id)} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function PluginRow({ info, config, onOpen }: { info: PluginInfo; config: ConfigStore; onOpen: () => void }) {
  const problem = pluginProblem(info, config);
  const statusId = `slick-plugin-status-${info.id}`;
  return (
    <li className="slick-settings__row" onClick={onOpen}>
      <div className="slick-settings__row-text">
        <button
          type="button"
          className="c-button-unstyled slick-settings__row-name"
          aria-label={`${info.name} settings`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          {info.name}
        </button>
        {info.user && <span className="slick-settings__badge">User</span>}
        {info.description && <div className="slick-settings__row-description">{info.description}</div>}
        {problem && (
          <div
            id={statusId}
            className={`slick-settings__status${info.startError ? ' slick-settings__status--error' : ''}`}
          >
            {problem}
          </div>
        )}
      </div>
      <Switch
        checked={info.enabled}
        label={`Enable ${info.name}`}
        describedBy={problem ? statusId : undefined}
        onChange={(enabled) => queueConfigWrite(config, () => config.setPluginEnabled(info.id, enabled))}
      />
      <span className="slick-settings__chevron" aria-hidden="true">
        <elements.SvgIcon name="caret-right" size={16} inline />
      </span>
    </li>
  );
}

function PluginDetail({
  id,
  plugins,
  config,
  bridge,
  manager,
  onBack,
}: {
  id: string;
  plugins: PluginInfo[];
  config: ConfigStore;
  bridge: SlickBridge;
  manager: PluginManager;
  onBack: () => void;
}) {
  const info = plugins.find((plugin) => plugin.id === id);
  const back = (
    <button type="button" className="c-button-unstyled slick-settings__back" onClick={onBack}>
      <elements.SvgIcon name="arrow-left" size={16} inline />
      All plugins
    </button>
  );
  if (!info) {
    return (
      <div>
        {back}
        <div className="slick-settings__empty">This plugin isn’t installed any more.</div>
      </div>
    );
  }

  const values = config.settingsFor(info.id);
  const entries = Object.entries(info.settings);
  const problem = pluginProblem(info, config);
  const statusId = `slick-plugin-detail-status-${info.id}`;
  const category = categoryOf(info);
  return (
    <div>
      {back}
      <header className="slick-settings__detail-head">
        <div className="slick-settings__detail-text">
          <h3 className="slick-settings__detail-title">{info.name}</h3>
          {info.description && <div className="slick-settings__detail-description">{info.description}</div>}
          <div className="slick-settings__meta">
            <span className="slick-settings__badge">
              <Icon name={category ? CATEGORY_ICONS[category] : 'code'} />
              {categoryLabel(info)}
            </span>
            {info.user && <span className="slick-settings__badge">User plugin</span>}
            {info.authors && <span>By {info.authors}</span>}
          </div>
        </div>
        <Switch
          checked={info.enabled}
          label={`Enable ${info.name}`}
          describedBy={problem ? statusId : undefined}
          onChange={(enabled) => queueConfigWrite(config, () => config.setPluginEnabled(info.id, enabled))}
        />
      </header>
      {problem && (
        <div
          id={statusId}
          role={info.startError ? 'alert' : undefined}
          className={`slick-settings__notice${info.startError ? ' slick-settings__notice--error' : ''}`}
        >
          {problem}
          {info.startError && '. Turn this plugin off and on to retry.'}
        </div>
      )}
      {entries.length > 0 && (
        <Card title="Settings">
          {entries.map(([key, setting]) => (
            <SettingRow
              key={key}
              pluginId={info.id}
              settingKey={key}
              setting={setting}
              value={values[key]}
              restartRequired={
                ('restartRequired' in setting && setting.restartRequired === true) ||
                info.relaunchSettings.includes(key)
              }
              config={config}
              bridge={bridge}
            />
          ))}
        </Card>
      )}
      <Card title="Workspaces">
        <WorkspaceSettings info={info} config={config} />
      </Card>
      {info.user && (
        <Card title="Source">
          <Field
            label={info.source ? 'Installed from a URL' : 'Installed from a file'}
            description={info.source ?? `ID ${info.id}`}
          >
            {manager.supportsUserPlugins && (
              <elements.Button type="danger" size="small" onClick={() => void manager.removeUserPlugin(info.id)}>
                Remove plugin
              </elements.Button>
            )}
          </Field>
        </Card>
      )}
    </div>
  );
}

function InstallPlugin({ manager }: { manager: PluginManager }) {
  const picker = React.useRef<HTMLInputElement>(null);
  const [status, setStatus] = React.useState('');
  const [installing, setInstalling] = React.useState(false);
  const [url, setUrl] = React.useState('');
  const run = async (task: () => Promise<string>) => {
    setInstalling(true);
    try {
      setStatus(await task());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not install the plugin.');
    } finally {
      setInstalling(false);
    }
  };
  const installUrl = () =>
    run(async () => {
      const name = await manager.installUserPluginFromUrl(url);
      setUrl('');
      return `Installed ${name}. It will keep itself up to date.`;
    });
  const checkUpdates = () =>
    run(async () => {
      const { updated, failed } = await manager.updateUserPlugins();
      const failures = failed ? ` ${failed} could not be checked.` : '';
      return (updated.length ? `Updated ${updated.join(', ')}.` : 'Everything is up to date.') + failures;
    });
  return (
    <div className="slick-settings">
      <Card title="Install plugins">
        <Field
          stacked
          label="From a URL"
          htmlFor="slick-install-url"
          description="Plugins installed from a URL are re-downloaded in the background and updated when the file changes."
        >
          <div className="slick-settings__inline">
            <input
              id="slick-install-url"
              className="c-input_text"
              type="url"
              placeholder="https://example.com/MyPlugin.js"
              value={url}
              disabled={installing}
              onChange={(event) => setUrl(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && url.trim()) void installUrl();
              }}
            />
            <elements.Button disabled={installing || !url.trim()} onClick={() => void installUrl()}>
              Install
            </elements.Button>
          </div>
        </Field>
        <Field label="From a file" description="A .js file built with bun run build:plugin.">
          <input
            ref={picker}
            type="file"
            accept=".js,text/javascript"
            aria-label="Install plugin file"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void run(async () => `Installed ${await manager.installUserPlugin(await file.text())}.`);
            }}
          />
          <elements.Button type="outline" disabled={installing} onClick={() => picker.current?.click()}>
            Choose file…
          </elements.Button>
        </Field>
      </Card>
      <Card title="Updates">
        <Field label="Update URL-installed plugins automatically">
          <Switch
            checked={manager.autoUpdatesEnabled}
            label="Update URL-installed plugins automatically"
            onChange={(enabled) => void manager.setAutoUpdate(enabled).catch(() => {})}
          />
        </Field>
        <Field label="Check now" description="Fetch the latest version of every plugin installed from a URL.">
          <elements.Button type="outline" disabled={installing} onClick={() => void checkUpdates()}>
            Check for updates
          </elements.Button>
        </Field>
      </Card>
      <div role="status" className="slick-settings__hint">
        {status}
      </div>
      <div className="slick-settings__notice">
        Plugins you install will have FULL ACCESS to your Slack data. Only install code you trust!
      </div>
    </div>
  );
}

const openLink = (url: string) => window.open(url, '_blank', 'noopener');

const WORKSPACE_OPTIONS = [
  { value: 'all', label: 'All workspaces' },
  { value: 'selected', label: 'Selected workspaces' },
];

function WorkspaceSettings({ info, config }: { info: PluginInfo; config: ConfigStore }) {
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const selected = config.workspacesFor(info.id);
  const current = currentWorkspaceId();
  const workspaces = knownWorkspaces(selected ?? []);
  const save = async (write: () => Promise<boolean>) => {
    setSaving(true);
    setError('');
    try {
      if (!(await write())) setError('Could not save workspace selection. Try again.');
    } catch {
      setError('Could not save workspace selection. Try again.');
    } finally {
      setSaving(false);
    }
  };
  if (info.appWideReason) return <Field label="All workspaces" description={info.appWideReason} />;
  return (
    <fieldset disabled={saving} className="slick-settings__fieldset">
      <Field
        label="Run this plugin in"
        description={
          selected === null
            ? 'Every workspace you are signed in to.'
            : selected.length
              ? 'Only the workspaces ticked below. Changes apply immediately.'
              : 'No workspaces selected. This plugin will not run anywhere.'
        }
      >
        <elements.BasicSelect
          selectId={`slick-workspaces-${info.id}`}
          ariaLabel="Run this plugin in"
          width={240}
          options={WORKSPACE_OPTIONS}
          selectedOption={WORKSPACE_OPTIONS[selected === null ? 0 : 1]}
          isDisabled={saving}
          onSelectionChange={(option) => {
            const next = option.value === 'all' ? null : current ? [current] : [];
            void save(() => config.setPluginWorkspaces(info.id, next));
          }}
        />
      </Field>
      {selected !== null && (
        <>
          {workspaces.map(({ id, name }) => (
            <Field key={id} label={`${name}${id === current ? ' (current)' : ''}`} description={id}>
              <Switch
                checked={selected.includes(id)}
                label={`Run in ${name}`}
                onChange={(included) => void save(() => config.setPluginWorkspace(info.id, id, included))}
              />
            </Field>
          ))}
          <div className="slick-settings__field">
            <Hint>Open another workspace in Slack to make it available here.</Hint>
          </div>
        </>
      )}
      {error && (
        <div role="alert" className="slick-settings__field slick-settings__status--error">
          {error}
        </div>
      )}
    </fieldset>
  );
}

const STACKED_TYPES = new Set<Setting['type']>(['text', 'file', 'schedule', 'names']);

function SettingRow({
  pluginId,
  settingKey,
  setting,
  value,
  restartRequired,
  config,
  bridge,
}: {
  pluginId: string;
  settingKey: string;
  setting: Setting;
  value: SettingValue;
  restartRequired: boolean;
  config: ConfigStore;
  bridge: SlickBridge;
}) {
  const save = (next: SettingValue) =>
    queueConfigWrite(config, () => config.setPluginSetting(pluginId, settingKey, next));
  const inputId = `slick-setting-${pluginId}-${settingKey}`;
  return (
    <Field
      htmlFor={setting.type === 'select' ? undefined : inputId}
      stacked={STACKED_TYPES.has(setting.type)}
      label={
        <>
          {setting.label}
          {restartRequired && (
            <span
              className="slick-settings__badge slick-settings__badge--warn"
              title="Restart Slick to apply this setting"
            >
              Needs restart
            </span>
          )}
        </>
      }
      description={setting.description}
    >
      <SettingControl
        id={inputId}
        setting={setting}
        value={value}
        save={save}
        bridge={bridge}
        owner={{ plugin: pluginId, setting: settingKey }}
      />
    </Field>
  );
}

function NumberControl({
  id,
  setting,
  value,
  save,
}: {
  id: string;
  setting: Extract<Setting, { type: 'number' }>;
  value: SettingValue;
  save: (value: SettingValue) => void;
}) {
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const coerced = coerceSetting(setting, text);
    setText(String(coerced));
    save(coerced);
  };
  return (
    <input
      id={id}
      className="c-input_text"
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(event) => setText(event.currentTarget.value)}
      onBlur={commit}
      style={{ width: '120px' }}
    />
  );
}

function SettingControl({
  id,
  setting,
  value,
  save,
  bridge,
  owner,
}: {
  id: string;
  setting: Setting;
  value: SettingValue;
  save: (value: SettingValue) => void;
  bridge: SlickBridge;
  owner: { plugin: string; setting: string };
}) {
  switch (setting.type) {
    case 'boolean':
      return <Switch id={id} checked={value === true} label={setting.label} onChange={save} />;
    case 'number':
      return <NumberControl id={id} setting={setting} value={value} save={save} />;
    case 'text':
      return (
        <input
          id={id}
          className="c-input_text"
          type="text"
          value={String(value)}
          maxLength={setting.maxLength}
          onChange={(event) => save(event.currentTarget.value)}
          style={{ width: '100%' }}
        />
      );
    case 'select': {
      const selected = setting.options.find((option) => option.value === value);
      return (
        <elements.BasicSelect
          selectId={id}
          ariaLabel={setting.label}
          width={240}
          options={setting.options}
          selectedOption={selected}
          onSelectionChange={(option) => save(option.value)}
        />
      );
    }
    case 'color':
      return (
        <input
          id={id}
          className="slick-settings__color"
          type="color"
          value={String(value)}
          onChange={(event) => save(event.target.value)}
        />
      );
    case 'file':
      return (
        <div className="slick-settings__inline">
          <elements.Button
            id={id}
            type="outline"
            size="small"
            onClick={() =>
              void bridge
                .openFile(setting.label, setting.accept, owner)
                .then((file) => file && save(file))
                .catch((error) => console.error('[slick] could not use that file:', error))
            }
          >
            Choose file…
          </elements.Button>
          <span style={{ overflowWrap: 'anywhere' }}>{fileLabel(value) || 'No file selected'}</span>
          {!!value && (
            <elements.Button type="ghost" size="small" aria-label={`Clear ${setting.label}`} onClick={() => save('')}>
              Clear
            </elements.Button>
          )}
        </div>
      );
    case 'schedule':
      return <ScheduleControl setting={setting} value={value} save={save} />;
    case 'names': {
      const names = typeof value === 'object' && !Array.isArray(value) ? value : {};
      const remove = (userId: string) => {
        const next = { ...names };
        delete next[userId];
        save(next);
      };
      return Object.entries(names).length ? (
        <ul style={{ margin: 0 }}>
          {Object.entries(names).map(([userId, name]) => (
            <li key={userId} style={{ marginBottom: '4px' }}>
              {name} <span style={{ opacity: 0.65 }}>({userId})</span>{' '}
              <elements.Button type="ghost" size="small" onClick={() => remove(userId)}>
                Remove
              </elements.Button>
            </li>
          ))}
        </ul>
      ) : (
        <Hint>No names configured.</Hint>
      );
    }
  }
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_PRESETS = [
  { label: 'Weekdays', short: 'Mon–Fri', days: [1, 2, 3, 4, 5] },
  { label: 'Weekends', short: 'Sat–Sun', days: [0, 6] },
  { label: 'Every day', short: 'Daily', days: [0, 1, 2, 3, 4, 5, 6] },
];
const CONTROL_HEIGHT = '32px';
const SCHEDULE_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(88px, 1fr) 60px 8px 60px 28px 172px 32px',
  alignItems: 'center',
  columnGap: '6px',
  rowGap: '8px',
  marginBottom: '10px',
};
const TIME_STYLE: React.CSSProperties = {
  width: '100%',
  height: CONTROL_HEIGHT,
  margin: 0,
  padding: '0 6px',
  textAlign: 'center',
  fontVariantNumeric: 'tabular-nums',
};
const MUTED: React.CSSProperties = { fontSize: '12px', opacity: 0.7, whiteSpace: 'nowrap' };

function daysLabel(days: number[]): string {
  const preset = DAY_PRESETS.find((option) => option.days.join() === days.join());
  if (preset) return preset.short;
  return days.length ? days.map((day) => DAY_NAMES[day]).join(', ') : 'Days';
}

function parseTime(text: string): string | undefined {
  const match = /^(\d{1,2}):?(\d{2})?$/.exec(text.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (hours > 23 || minutes > 59) return undefined;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function DaysPicker({ days, onChange }: { days: number[]; onChange: (days: number[]) => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const toggle = (day: number) =>
    onChange(days.includes(day) ? days.filter((other) => other !== day) : [...days, day].toSorted((a, b) => a - b));

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <elements.Button
        type="outline"
        size="small"
        aria-expanded={open}
        title={daysLabel(days)}
        onClick={() => setOpen(!open)}
        style={{ width: '100%', height: CONTROL_HEIGHT, justifyContent: 'space-between', gap: '6px' }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{daysLabel(days)}</span>
        <span style={{ opacity: 0.6 }}>▾</span>
      </elements.Button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 10,
            width: '180px',
            padding: '6px',
            borderRadius: '8px',
            background: 'rgb(var(--sk_primary_background, 255, 255, 255))',
            border: '1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.13)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              paddingBottom: '6px',
              marginBottom: '6px',
              borderBottom: '1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.13)',
            }}
          >
            {DAY_PRESETS.map((preset) => (
              <elements.Button
                key={preset.label}
                type="ghost"
                size="small"
                onClick={() => onChange(preset.days)}
                style={{ width: '100%', justifyContent: 'space-between' }}
              >
                <span>{preset.label}</span>
                <span>{preset.days.join() === days.join() ? '✓' : ''}</span>
              </elements.Button>
            ))}
          </div>
          {DAY_NAMES.map((name, day) => (
            <label
              key={name}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 2px', cursor: 'pointer' }}
            >
              <input
                className="c-input_checkbox"
                type="checkbox"
                checked={days.includes(day)}
                onChange={() => toggle(day)}
              />
              {name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function TimeInput({ value, label, onChange }: { value: string; label: string; onChange: (time: string) => void }) {
  const [text, setText] = React.useState(value);
  React.useEffect(() => setText(value), [value]);
  const commit = () => {
    const time = parseTime(text);
    setText(time ?? value);
    if (time && time !== value) onChange(time);
  };
  return (
    <input
      className="c-input_text"
      type="text"
      inputMode="numeric"
      placeholder="HH:MM"
      aria-label={label}
      value={text}
      onChange={(event) => setText(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === 'Enter' && commit()}
      style={TIME_STYLE}
    />
  );
}

function ScheduleControl({
  setting,
  value,
  save,
}: {
  setting: Extract<Setting, { type: 'schedule' }>;
  value: SettingValue;
  save: (value: SettingValue) => void;
}) {
  const rules = Array.isArray(value) ? value : [];
  const update = (index: number, patch: Partial<ScheduleRule>) =>
    save(rules.map((rule, other) => (other === index ? { ...rule, ...patch } : rule)));
  const add = () => save([...rules, { days: [], start: '17:00', end: '09:00', status: setting.statuses[0].value }]);

  return (
    <div>
      {rules.length > 0 && (
        <div style={SCHEDULE_GRID}>
          {rules.map((rule, index) => (
            <React.Fragment key={index}>
              <DaysPicker days={rule.days} onChange={(days) => update(index, { days })} />
              <TimeInput value={rule.start} label="Start time" onChange={(start) => update(index, { start })} />
              <span style={{ textAlign: 'center', opacity: 0.7 }}>–</span>
              <TimeInput value={rule.end} label="End time" onChange={(end) => update(index, { end })} />
              <span style={MUTED} title={rule.end <= rule.start ? 'Ends the next day' : undefined}>
                {rule.end <= rule.start ? '+1d' : ''}
              </span>
              <elements.BasicSelect
                selectId={`slick-schedule-status-${index}`}
                ariaLabel="Status"
                size="small"
                width="100%"
                options={setting.statuses}
                selectedOption={setting.statuses.find((option) => option.value === rule.status)}
                onSelectionChange={(option) => update(index, { status: option.value })}
              />
              <elements.Button
                type="ghost"
                size="small"
                aria-label="Remove"
                title="Remove"
                onClick={() => save(rules.filter((_, other) => other !== index))}
                style={{ width: CONTROL_HEIGHT, height: CONTROL_HEIGHT, padding: 0, justifyContent: 'center' }}
              >
                ✕
              </elements.Button>
            </React.Fragment>
          ))}
        </div>
      )}
      <elements.Button type="outline" size="small" onClick={add} style={{ height: CONTROL_HEIGHT }}>
        + New
      </elements.Button>
    </div>
  );
}

type ThemePreview = { background: string; sidebar: string; text: string; accent: string };

const SLACK_PREVIEW: ThemePreview = { background: '#ffffff', sidebar: '#4a154b', text: '#1d1c1d', accent: '#1264a3' };

function isDark(color: string): boolean {
  const hex = /^#([0-9a-f]{6})/i.exec(color)?.[1];
  if (!hex) return true;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 < 140;
}

function themePreview(theme: ThemeJson): ThemePreview {
  const pick = (source: Record<string, unknown> | undefined, ...keys: string[]) => {
    for (const key of keys) if (typeof source?.[key] === 'string') return source[key] as string;
    return undefined;
  };
  const background = pick(theme.vars, '--dt_color-base-pry') ?? '#1a1d21';
  return {
    background,
    sidebar: pick(theme.sidebar, 'nav-bg') ?? pick(theme.vars, '--dt_color-theme-base-inv-pry') ?? background,
    text:
      pick(theme.vars, '--dt_color-content-pry') ??
      pick(theme.sidebar, 'text-color') ??
      (isDark(background) ? '#d1d2d3' : '#1d1c1d'),
    accent: pick(theme.vars, '--dt_color-content-hgl-1') ?? pick(theme.sidebar, 'badge') ?? '#1d9bd1',
  };
}

function ThemeCard({
  name,
  description,
  preview,
  selected,
  onSelect,
  onRemove,
}: {
  name: string;
  description?: string;
  preview: ThemePreview | null;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className="slick-settings__theme"
      aria-checked={selected}
      role="radio"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {preview ? (
        <div className="slick-settings__theme-preview" style={{ background: preview.background }} aria-hidden="true">
          <div className="slick-settings__theme-sidebar" style={{ background: preview.sidebar }}>
            <span style={{ background: preview.text }} />
            <span style={{ background: preview.accent, opacity: 1 }} />
            <span style={{ background: preview.text }} />
          </div>
          <div className="slick-settings__theme-main">
            <span style={{ background: preview.text, width: '70%' }} />
            <span style={{ background: preview.text, width: '45%' }} />
            <span style={{ background: preview.accent, width: '30%', opacity: 1 }} />
          </div>
        </div>
      ) : (
        <div className="slick-settings__theme-preview slick-settings__theme-preview--css" aria-hidden="true">
          <elements.SvgIcon name="code" size={24} inline />
        </div>
      )}
      <div className="slick-settings__theme-text">
        <div className="slick-settings__theme-name">
          {name}
          {selected && (
            <span className="slick-settings__theme-check" aria-hidden="true">
              <elements.SvgIcon name="check" size={16} inline />
            </span>
          )}
        </div>
        {description && <div className="slick-settings__theme-description">{description}</div>}
      </div>
      {onRemove && (
        <button
          type="button"
          className="c-button-unstyled slick-settings__theme-remove"
          aria-label={`Remove ${name}`}
          title="Remove imported theme"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <elements.SvgIcon name="trash" size={16} inline />
        </button>
      )}
    </div>
  );
}

function ThemesPanel({ config, bridge }: { config: ConfigStore; bridge: SlickBridge }) {
  useConfigChanges(config);
  const picker = React.useRef<HTMLInputElement>(null);
  const [status, setStatus] = React.useState('');
  const [importing, setImporting] = React.useState(false);
  const known = new Set(['', 'custom', ...Object.keys(__SLICK_THEMES__), ...Object.keys(config.importedThemes)]);
  const current = known.has(config.theme) ? config.theme : '';
  const select = (theme: string) => queueConfigWrite(config, () => config.setTheme(theme));
  const remove = async (id: string) =>
    setStatus((await config.removeTheme(id)) ? 'Removed imported theme.' : 'Could not remove the theme.');

  return (
    <div className="slick-settings">
      <section className="slick-settings__section">
        <div className="slick-settings__section-head">
          <h3 className="slick-settings__section-title">Theme</h3>
          <elements.Button type="outline" size="small" disabled={importing} onClick={() => picker.current?.click()}>
            Import theme JSON…
          </elements.Button>
        </div>
        <input
          ref={picker}
          type="file"
          accept=".json,application/json"
          aria-label="Import theme JSON"
          hidden
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            setImporting(true);
            try {
              if (file.size > 256 * 1024) throw new Error('Theme files must be smaller than 256 KiB.');
              const theme = parseThemeJson(await file.text(), file.name);
              if (!(await config.importTheme(`imported:${crypto.randomUUID()}`, theme)))
                throw new Error('Could not save the theme.');
              setStatus(`Imported ${theme.name}.`);
            } catch (error) {
              setStatus(error instanceof Error ? error.message : 'Could not import the theme.');
            } finally {
              setImporting(false);
            }
          }}
        />
        <div className="slick-settings__themes" role="radiogroup" aria-label="Theme">
          <ThemeCard
            name="Slack"
            description="Slack’s own colors"
            preview={SLACK_PREVIEW}
            selected={current === ''}
            onSelect={() => select('')}
          />
          {Object.entries(__SLICK_THEMES__).map(([id, theme]) => (
            <ThemeCard
              key={id}
              name={theme.name || id}
              description={theme.description}
              preview={themePreview(theme)}
              selected={current === id}
              onSelect={() => select(id)}
            />
          ))}
          {Object.entries(config.importedThemes).map(([id, theme]) => (
            <ThemeCard
              key={id}
              name={theme.name || id}
              description={theme.description || 'Imported'}
              preview={themePreview(theme)}
              selected={current === id}
              onSelect={() => select(id)}
              onRemove={() => void remove(id)}
            />
          ))}
          <ThemeCard
            name="Custom CSS only"
            description="No theme, just your own CSS"
            preview={null}
            selected={current === 'custom'}
            onSelect={() => select('custom')}
          />
        </div>
        <div role="status" className="slick-settings__hint">
          {status}
        </div>
        <Hint>Match Slack’s Light or Dark mode (Preferences &gt; Appearance) to your theme for the best result.</Hint>
      </section>
      <Card title="Custom CSS">
        <Field
          label="Your CSS"
          description="Raw CSS applied on top of the selected theme. For a JSON theme file, use Import theme JSON above."
        >
          {bridge.loader === 'extension' ? (
            // Slack's page may not open extension tabs; the toolbar popup owns the editor.
            <Hint>Edit it from the Slick button in the browser toolbar.</Hint>
          ) : (
            <elements.Button type="outline" onClick={() => void bridge.openCssEditor()}>
              Open CSS editor
            </elements.Button>
          )}
        </Field>
      </Card>
    </div>
  );
}
