import type { Setting, SettingValue } from '../shared/settings.ts';
import { coerceSetting } from '../shared/settings.ts';
import { elementsReady, type SelectOption } from './api/elements.ts';
import type { SlickBridge } from './bridge.ts';
import type { ConfigStore } from './configStore.ts';
import type { PluginManager } from './pluginManager.ts';
import { patchComponent, reactReady } from './slack/react.tsx';

let elements: Awaited<typeof elementsReady>;

type TabsProps = {
  tabs: {
    id?: string;
    label: React.ReactElement;
    content: React.ReactElement;
    svgIcon: { name: string };
    'aria-label'?: string;
  }[];
  onTabChange?: (id: string, event: React.UIEvent) => void;
  currentTabId?: string;
};

type PluginInfo = ReturnType<PluginManager['info']>[number];

export async function addSettingsTab(manager: PluginManager, config: ConfigStore, bridge: SlickBridge) {
  await reactReady;
  elements = await elementsReady;

  // Adapted from Taut's MIT-licensed settings tab. Keeping Slack on its real
  // Advanced route avoids teaching its Preferences router an unknown route.
  patchComponent<TabsProps>('Tabs', (Original) => (props) => {
    const [slickSelected, setSlickSelected] = React.useState(false);
    const tabs = [...props.tabs];
    if (tabs.at(-1)?.id === 'advanced' && !tabs.some((tab) => tab.id === 'slick')) {
      tabs.push({
        id: 'slick',
        label: <>Slick</>,
        content: <SlickSettings manager={manager} config={config} bridge={bridge} />,
        svgIcon: { name: 'code' },
        'aria-label': 'Slick',
      });
    }

    const onTabChange = (id: string, event: React.UIEvent) => {
      setSlickSelected(id === 'slick');
      props.onTabChange?.(id === 'slick' ? 'advanced' : id, event);
    };

    return (
      <Original
        {...props}
        tabs={tabs}
        currentTabId={slickSelected ? 'slick' : props.currentTabId}
        onTabChange={onTabChange}
      />
    );
  });
}

function useConfigChanges(config: ConfigStore) {
  const [, render] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => config.onConfigChange(render), [config]);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '28px' }}>
      <h2 style={{ fontSize: '18px', marginBottom: '12px' }}>{title}</h2>
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
  return (
    <div style={{ paddingBottom: '24px' }}>
      <Section title="Plugins">
        {manager.info().map((info) => (
          <PluginRow key={info.id} info={info} config={config} bridge={bridge} />
        ))}
      </Section>
      <Appearance config={config} bridge={bridge} />
      <Section title="About">
        <div>Slick {__SLICK_VERSION__}</div>
        <elements.Hint>Build {__SLICK_BUILD__}</elements.Hint>
      </Section>
    </div>
  );
}

function PluginRow({ info, config, bridge }: { info: PluginInfo; config: ConfigStore; bridge: SlickBridge }) {
  const [expanded, setExpanded] = React.useState(false);
  const values = config.settingsFor(info.id);
  const entries = Object.entries(info.settings);

  return (
    <div style={{ borderTop: '1px solid rgba(127,127,127,.2)', padding: '14px 0' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <elements.Checkbox
          id={`slick-plugin-${info.id}`}
          checked={info.enabled}
          onChange={(event) => void config.setPluginEnabled(info.id, event.target.checked)}
          label={
            <span>
              <strong>{info.name}</strong>
              {info.description && <span style={{ display: 'block', fontWeight: 'normal' }}>{info.description}</span>}
              {info.authors && <span style={{ display: 'block', opacity: 0.7 }}>By {info.authors}</span>}
            </span>
          }
        />
        {!!entries.length && (
          <elements.Button
            type="ghost"
            size="small"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Hide settings' : 'Settings'}
          </elements.Button>
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
  const save = (next: SettingValue) => void config.setPluginSetting(pluginId, settingKey, next);
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>{setting.label}</div>
      <SettingControl setting={setting} value={value} save={save} bridge={bridge} />
      {setting.description && <elements.Hint>{setting.description}</elements.Hint>}
      {restartRequired && (
        <div style={{ color: 'var(--sk_raspberry_red, #e01e5a)', fontSize: '12px', marginTop: '4px' }}>
          Restart Slick to apply this setting.
        </div>
      )}
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
  return <elements.FormTextInput value={text} onChange={setText} onBlur={commit} />;
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
      return <elements.Checkbox checked={value === true} onChange={(event) => save(event.target.checked)} />;
    case 'number':
      return <NumberControl setting={setting} value={value} save={save} />;
    case 'text':
      return <elements.FormTextInput value={String(value)} onChange={save} maxCharacterLimit={setting.maxLength} />;
    case 'select': {
      const selected = setting.options.find((option) => option.value === value);
      return (
        <elements.BasicSelect
          selectId={`slick-select-${setting.label}`}
          options={setting.options}
          selectedOption={selected}
          onSelectionChange={(option) => save(option.value)}
          ariaLabel={setting.label}
          width={320}
        />
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
    case 'names': {
      const names = typeof value === 'object' ? value : {};
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
        <elements.Hint>No names configured.</elements.Hint>
      );
    }
  }
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
        <elements.BasicSelect
          selectId="slick-theme"
          options={options}
          selectedOption={selected}
          onSelectionChange={(option) => void config.setTheme(option.value)}
          ariaLabel="Theme"
          width={320}
        />
      </div>
      <elements.Button onClick={() => void bridge.openCssEditor()}>Open CSS editor</elements.Button>
    </Section>
  );
}
