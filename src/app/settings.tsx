import type { ScheduleRule, Setting, SettingValue } from '../shared/settings.ts';
import { coerceSetting } from '../shared/settings.ts';
import { elementsReady, type SelectOption } from './api/elements.ts';
import { setStyle } from './api/css.ts';
import { settingsTabs, type SettingsTab } from './api/settingsTabs.ts';
import type { SlickBridge } from './bridge.ts';
import type { ConfigStore } from './configStore.ts';
import type { PluginManager } from './pluginManager.ts';
import { patchComponent, reactReady } from './slack/react.tsx';

let elements: Awaited<typeof elementsReady>;
let warnedUnrecognisedTabs = false;
const configWriteQueues = new WeakMap<ConfigStore, Promise<void>>();

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

// this makes the preferences window wider and taller, and lets the tab list scroll rather than collapse
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
`;

/** Enough matches to be sure, few enough to survive Slack dropping sections. */
const MIN_PREFERENCES_TABS = 3;

/** Slack's .c-select_input is absolutely positioned to fill a wrapper; keep ours in flow. */
const SELECT_STYLE: React.CSSProperties = { position: 'relative', width: '320px', height: 'auto' };
const TEXT_STYLE: React.CSSProperties = { width: '320px', margin: 0 };

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

  // Adapted from Taut's MIT-licensed settings tab. Keeping Slack on its real
  // Advanced route avoids teaching its Preferences router an unknown route.
  patchComponent<TabsProps>('Tabs', (Original) => (props) => {
    const [selected, setSelected] = React.useState<string | null>(null);
    const pluginTabs = settingsTabs.use();

    const known = props.tabs.filter((tab) => tab.id !== undefined && PREFERENCES_TAB_IDS.has(tab.id));
    if (known.length < MIN_PREFERENCES_TABS) {
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
    inject('slick', 'Slick', <SlickSettings manager={manager} config={config} bridge={bridge} />);
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
  return <div style={{ fontSize: '12px', opacity: 0.7 }}>{children}</div>;
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '28px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: '12px',
        }}
      >
        <h2 style={{ fontSize: '18px', margin: 0 }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SlickSettings({
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
  const [query, setQuery] = React.useState('');
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const plugins = manager.info().filter((info) => {
    const haystack = [info.id, info.name, info.description, info.authors].join(' ').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  return (
    <div style={{ paddingBottom: '24px' }}>
      <Section
        title="Plugins"
        action={
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
            style={{ ...TEXT_STYLE, width: '240px' }}
          />
        }
      >
        {plugins.map((info) => (
          <PluginRow key={info.id} info={info} config={config} bridge={bridge} />
        ))}
        {!plugins.length && (
          <div style={{ borderTop: '1px solid rgba(127,127,127,.2)', padding: '14px 0' }}>
            <Hint>No plugins match “{query.trim()}”.</Hint>
          </div>
        )}
      </Section>
      <Appearance config={config} bridge={bridge} />
      <Section title="About">
        <div>Slick {__SLICK_VERSION__}</div>
        <Hint>Build {__SLICK_BUILD__}</Hint>
      </Section>
    </div>
  );
}

/** Inlined: a wrong `SvgIcon` name renders nothing at all. */
function CogIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      width="15"
      height="15"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.486 1.286a4 4 0 0 0-2.972 0 .75.75 0 0 0-.45.518l-.372 1.523-.004.018a.5.5 0 0 1-.758.314l-.016-.01-1.34-.813a.75.75 0 0 0-.685-.048 4 4 0 0 0-2.1 2.1.75.75 0 0 0 .047.685l.814 1.34.01.016a.5.5 0 0 1-.314.759l-.018.004-1.523.372a.75.75 0 0 0-.519.45 4 4 0 0 0 0 2.971.75.75 0 0 0 .519.45l1.523.373.018.004a.5.5 0 0 1 .314.758l-.01.016-.814 1.34a.75.75 0 0 0-.048.685 4 4 0 0 0 2.101 2.1.75.75 0 0 0 .685-.048l1.34-.813.016-.01a.5.5 0 0 1 .758.314l.004.018.372 1.523a.75.75 0 0 0 .45.518 4 4 0 0 0 2.972 0 .75.75 0 0 0 .45-.518l.372-1.523.004-.018a.5.5 0 0 1 .758-.314l.016.01 1.34.813a.75.75 0 0 0 .685.049 4 4 0 0 0 2.101-2.101.75.75 0 0 0-.048-.685l-.814-1.34-.01-.016a.5.5 0 0 1 .314-.758l.018-.004 1.523-.373a.75.75 0 0 0 .519-.45 4 4 0 0 0 0-2.97.75.75 0 0 0-.519-.45l-1.523-.373-.018-.004a.5.5 0 0 1-.314-.759l.01-.015.814-1.34a.75.75 0 0 0 .048-.685 4 4 0 0 0-2.101-2.101.75.75 0 0 0-.685.048l-1.34.814-.016.01a.5.5 0 0 1-.758-.315l-.004-.017-.372-1.524a.75.75 0 0 0-.45-.518M8 10a2 2 0 1 1 4 0 2 2 0 0 1-4 0m2-3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7"
      />
    </svg>
  );
}

function PluginRow({ info, config, bridge }: { info: PluginInfo; config: ConfigStore; bridge: SlickBridge }) {
  const [expanded, setExpanded] = React.useState(false);
  const values = config.settingsFor(info.id);
  const entries = Object.entries(info.settings);
  const inputId = `slick-plugin-${info.id}`;
  const statusId = `slick-plugin-status-${info.id}`;

  return (
    <div style={{ borderTop: '1px solid rgba(127,127,127,.2)', padding: '14px 0' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        {/* Plain input: Slack's Checkbox ignores a `label` prop, leaving rows unnamed. */}
        <input
          id={inputId}
          className="c-input_checkbox"
          type="checkbox"
          checked={info.enabled}
          aria-describedby={info.enabled && !info.running ? statusId : undefined}
          onChange={(event) => {
            const enabled = event.currentTarget.checked;
            queueConfigWrite(config, () => config.setPluginEnabled(info.id, enabled));
          }}
          style={{ marginTop: '2px', flex: '0 0 auto' }}
        />
        <label htmlFor={inputId} style={{ flex: '1 1 auto', cursor: 'pointer', margin: 0 }}>
          <span style={{ fontWeight: 700 }}>{info.name}</span>
          {info.description && (
            <span style={{ display: 'block', fontWeight: 400, opacity: 0.85 }}>{info.description}</span>
          )}
          {info.authors && <span style={{ display: 'block', fontSize: '12px', opacity: 0.6 }}>By {info.authors}</span>}
          {info.enabled && !info.running && (
            <span
              id={statusId}
              role={info.startError ? 'alert' : undefined}
              style={{ display: 'block', fontSize: '12px', color: 'var(--sk_raspberry_red, #e01e5a)' }}
            >
              {info.startError
                ? `Could not start: ${info.startError}. Turn this plugin off and on to retry.`
                : 'Starting…'}
            </span>
          )}
        </label>
        {!!entries.length && (
          <button
            type="button"
            className="c-button-unstyled"
            aria-expanded={expanded}
            aria-label={`Configure ${info.name}`}
            title={`Configure ${info.name}`}
            onClick={() => setExpanded((value) => !value)}
            style={{
              flex: '0 0 auto',
              padding: '4px',
              borderRadius: '4px',
              cursor: 'pointer',
              opacity: expanded ? 1 : 0.55,
              color: 'currentColor',
            }}
          >
            <CogIcon />
          </button>
        )}
      </div>
      {expanded && (
        <div style={{ margin: '14px 0 0 30px' }}>
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
        </div>
      )}
    </div>
  );
}

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
  const note = restartRequired ? (
    <div style={{ color: 'var(--sk_raspberry_red, #e01e5a)', fontSize: '12px', marginTop: '4px' }}>
      Restart Slick to apply this setting.
    </div>
  ) : null;

  // Checkboxes sit beside their label; every other control gets its label above.
  if (setting.type === 'boolean') {
    return (
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
          <input
            id={inputId}
            className="c-input_checkbox"
            type="checkbox"
            checked={value === true}
            onChange={(event) => save(event.currentTarget.checked)}
            style={{ flex: '0 0 auto' }}
          />
          <label htmlFor={inputId} style={{ margin: 0, fontWeight: 700, cursor: 'pointer' }}>
            {setting.label}
          </label>
        </div>
        {setting.description && (
          <div style={{ marginLeft: '26px' }}>
            <Hint>{setting.description}</Hint>
          </div>
        )}
        {note}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>{setting.label}</div>
      <SettingControl setting={setting} value={value} save={save} bridge={bridge} />
      {setting.description && (
        <div style={{ marginTop: '6px' }}>
          <Hint>{setting.description}</Hint>
        </div>
      )}
      {note}
    </div>
  );
}

function NumberControl({
  setting,
  value,
  save,
}: {
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
      className="c-input_text"
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(event) => setText(event.currentTarget.value)}
      onBlur={commit}
      style={TEXT_STYLE}
    />
  );
}

function SettingControl({
  setting,
  value,
  save,
  bridge,
}: {
  setting: Setting;
  value: SettingValue;
  save: (value: SettingValue) => void;
  bridge: SlickBridge;
}) {
  switch (setting.type) {
    case 'boolean':
      // Plain input, as in PluginRow: Slack's Checkbox prop shape is unknown.
      return (
        <input
          className="c-input_checkbox"
          type="checkbox"
          checked={value === true}
          onChange={(event) => save(event.currentTarget.checked)}
        />
      );
    case 'number':
      return <NumberControl setting={setting} value={value} save={save} />;
    case 'text':
      return (
        <input
          className="c-input_text"
          type="text"
          value={String(value)}
          maxLength={setting.maxLength}
          onChange={(event) => save(event.currentTarget.value)}
          style={TEXT_STYLE}
        />
      );
    case 'select': {
      const selected = setting.options.find((option) => option.value === value);
      return (
        <select
          className="c-select_input"
          aria-label={setting.label}
          value={selected?.value ?? ''}
          onChange={(event) => save(event.currentTarget.value)}
          style={SELECT_STYLE}
        >
          {setting.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }
    case 'color':
      return (
        <input
          type="color"
          value={String(value)}
          aria-label={setting.label}
          onChange={(event) => save(event.target.value)}
        />
      );
    case 'file':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <elements.Button
            size="small"
            onClick={() => void bridge.openFile(setting.label, setting.accept).then((file) => file && save(file))}
          >
            Choose file…
          </elements.Button>
          <span style={{ overflowWrap: 'anywhere' }}>{String(value) || 'No file selected'}</span>
        </div>
      );
    case 'schedule':
      return <ScheduleControl setting={setting} value={value} save={save} />;
    case 'names': {
      const names = typeof value === 'object' && !Array.isArray(value) ? value : {};
      const remove = (id: string) => {
        const next = { ...names };
        delete next[id];
        save(next);
      };
      return Object.entries(names).length ? (
        <ul style={{ margin: 0 }}>
          {Object.entries(names).map(([id, name]) => (
            <li key={id} style={{ marginBottom: '4px' }}>
              {name} <span style={{ opacity: 0.65 }}>({id})</span>{' '}
              <elements.Button type="ghost" size="small" onClick={() => remove(id)}>
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
              <select
                className="c-select_input"
                aria-label="Status"
                value={rule.status}
                onChange={(event) => update(index, { status: event.currentTarget.value })}
                style={{ ...SELECT_STYLE, width: '100%', height: CONTROL_HEIGHT }}
              >
                {setting.statuses.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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

function Appearance({ config, bridge }: { config: ConfigStore; bridge: SlickBridge }) {
  const options: SelectOption[] = [
    { value: '', label: 'None' },
    ...Object.entries(__SLICK_THEMES__).map(([id, theme]) => ({ value: id, label: theme.name || id })),
    { value: 'custom', label: 'Custom' },
  ];
  const selected = options.find((option) => option.value === config.theme) ?? options[0];

  return (
    <Section title="Appearance">
      <div style={{ marginBottom: '14px' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>Theme</div>
        <select
          className="c-select_input"
          aria-label="Theme"
          value={selected.value}
          onChange={(event) => {
            const theme = event.currentTarget.value;
            queueConfigWrite(config, () => config.setTheme(theme));
          }}
          style={SELECT_STYLE}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div style={{ marginTop: '6px' }}>
          When using these themes, it is recommend to set your native Slack theme to Dark mode for the best visual
          experience.
        </div>
      </div>
      {bridge.loader === 'extension' ? (
        // Slack's page may not open extension tabs; the toolbar popup owns the editor.
        <div style={{ opacity: 0.85 }}>Edit custom CSS from the Slick button in the Firefox toolbar.</div>
      ) : (
        <elements.Button onClick={() => void bridge.openCssEditor()}>Open CSS editor</elements.Button>
      )}
    </Section>
  );
}
