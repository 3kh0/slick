import { extensionBrowser, MAX_TEXT, RENDERERS, record, validMethodResponse, validRequest } from './rpc.ts';
import type { ExtensionBrowser, Method } from './rpc.ts';
import { SLACK_ACCESS, SLACK_ACCESS_PLUGINS } from './plugins.ts';
import { CSS_KEY, SETTINGS_KEY } from './storage.ts';
import { USER_PLUGINS_KEY, installedPlugins, parsePluginFile, userScripts } from './userPlugins.ts';
import { importedThemes, isThemeJson, parseThemeJson, type ThemeJson } from '../shared/themes.ts';
import { COG_PATH } from '../shared/icons.ts';
import { coerceSetting, type Setting, type SettingsSchema } from '../shared/settings.ts';
import { appWideReason, workspaceSelection, WORKSPACE_ID } from '../shared/pluginWorkspaces.ts';
type OptionsBrowser = ExtensionBrowser & {
  tabs: { query(options: { active: true; currentWindow: true }): Promise<{ id?: number; url?: string }[]> };
  scripting: {
    executeScript(options: {
      target: { tabId: number };
      world: 'MAIN';
      func: typeof recoveryScript;
      args: [Recovery];
    }): Promise<{ result?: boolean }[]>;
  };
};
type Send = ExtensionBrowser['runtime']['sendMessage'];
export type Change =
  | { property: 'enabled'; value: boolean }
  | { property: 'theme'; value: string }
  | { property: 'importTheme'; id: string; value: ThemeJson }
  | { property: 'removeTheme'; id: string }
  | { property: 'toolbarIcon'; value: string }
  | { property: 'plugin'; id: (typeof RENDERERS)[number]; value: boolean }
  | { property: 'pluginWorkspaces'; id: (typeof RENDERERS)[number]; value: string[] | null }
  | { property: 'pluginSetting'; id: (typeof RENDERERS)[number]; key: string; value: boolean | number | string };

export async function request(send: Send, method: Method, args: string[] = []) {
  if (!validRequest({ method, args })) throw new Error('Invalid request');
  const response = await send({ method, args });
  if (!validMethodResponse(method, response) || !response.ok) throw new Error('Extension request failed');
  return response.value;
}

export function parseSettings(text: string): Record<string, unknown> {
  const config: unknown = JSON.parse(text);
  if (!record(config)) throw new Error('Invalid settings');
  return config;
}

export async function updateSetting(send: Send, change: Change): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const previous = (await request(send, 'readSettings')) as string;
    const config = parseSettings(previous);
    if (change.property === 'pluginWorkspaces') {
      if (appWideReason(change.id)) throw new Error('This plugin runs in all workspaces');
      if (change.value !== null && !change.value.every((id) => WORKSPACE_ID.test(id)))
        throw new Error('Invalid workspace ID');
      const selected = record(config.pluginWorkspaces) ? config.pluginWorkspaces : {};
      config.pluginWorkspaces = { ...selected, [change.id]: workspaceSelection(change.value) };
    } else if (change.property === 'importTheme') {
      if (!change.id.startsWith('imported:') || !isThemeJson(change.value)) throw new Error('Invalid theme');
      config.importedThemes = { ...importedThemes(config.importedThemes), [change.id]: change.value };
      config.theme = change.id;
    } else if (change.property === 'removeTheme') {
      const themes = importedThemes(config.importedThemes);
      delete themes[change.id];
      config.importedThemes = themes;
      if (config.theme === change.id) config.theme = '';
    } else if (change.property === 'plugin' || change.property === 'pluginSetting') {
      if (config.plugins !== undefined && !record(config.plugins)) throw new Error('Invalid plugins');
      const plugins = record(config.plugins) ? config.plugins : {};
      const prior = plugins[change.id];
      if (prior !== undefined && !record(prior)) throw new Error('Invalid plugin');
      const key = change.property === 'plugin' ? 'enabled' : change.key;
      if (key === '__proto__') throw new Error('Invalid setting');
      config.plugins = { ...plugins, [change.id]: { ...(record(prior) ? prior : {}), [key]: change.value } };
    } else {
      config[change.property] = change.value;
    }
    if (await request(send, 'compareAndSwapSettings', [previous, JSON.stringify(config)])) return;
  }
  throw new Error('Settings are busy');
}

// Keep the draft until a positive acknowledgement, including edits made during a save.
export class CssDraft {
  value = '';
  dirty = false;
  saving = false;
  remote(value: string) {
    if (!this.dirty && !this.saving) this.value = value;
  }
  edit(value: string) {
    this.value = value;
    this.dirty = true;
  }
  async save(send: Send) {
    if (this.saving) return;
    const submitted = this.value;
    this.saving = true;
    try {
      if ((await request(send, 'writeUserCss', [submitted])) !== true) throw new Error('CSS not saved');
      if (this.value === submitted) this.dirty = false;
    } finally {
      this.saving = false;
    }
  }
}

export type Recovery = 'bypass' | 'resume' | 'safe-mode';
export function slackClient(url?: string): boolean {
  try {
    const parsed = new URL(url ?? '');
    return parsed.origin === 'https://app.slack.com' && /^\/client(\/|$)/.test(parsed.pathname);
  } catch {
    return false;
  }
}

// Serialized by executeScript: no closure, eval, remote code, or URL interpolation.
export function recoveryScript(mode: Recovery): boolean {
  if (location.origin !== 'https://app.slack.com' || !/^\/client(\/|$)/.test(location.pathname)) return false;
  if (mode === 'bypass') {
    sessionStorage.setItem('slick:firefox:bypass', '1');
  } else if (mode === 'resume') {
    sessionStorage.removeItem('slick:firefox:bypass');
    sessionStorage.removeItem('slick:firefox:safe-mode');
  } else if (mode === 'safe-mode') {
    sessionStorage.setItem('slick:firefox:safe-mode', '1');
    sessionStorage.removeItem('slick:firefox:bypass');
  } else return false;
  location.reload();
  return true;
}

export async function recover(api: OptionsBrowser, mode: Recovery): Promise<void> {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (tabs.length !== 1 || tab?.id === undefined || !slackClient(tab.url)) throw new Error('No active Slack client');
  const results = await api.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: recoveryScript,
    args: [mode],
  });
  if (results.length !== 1 || results[0].result !== true) throw new Error('Recovery not confirmed');
}

export type OptionsData = {
  plugins: { id: string; name: string; description: string; settings?: SettingsSchema }[];
  themes: { id: string; name: string; background: string | null; accent: string | null }[];
  version: string;
};

type Inline = Exclude<Setting, { type: 'names' | 'schedule' }>;
const inline = (setting: Setting): setting is Inline =>
  ['boolean', 'number', 'text', 'color', 'select'].includes(setting.type);

function cogIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('d', COG_PATH);
  svg.append(path);
  return svg;
}

const TABS = ['plugins', 'appearance', 'troubleshooting', 'about'] as const;
const TAB_KEY = 'slick:options:tab';
const THEME_KEY = 'slick:options:theme';

export function mount(api: OptionsBrowser | undefined, data: OptionsData) {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const popup = new URLSearchParams(location.search).has('popup');
  document.documentElement.classList.toggle('popup', popup);

  const error = element('error');
  const errorText = element('error-text');
  const status = element('status');
  const settings = element<HTMLFieldSetElement>('settings');
  const paused = element('paused');
  const theme = element<HTMLSelectElement>('theme');
  const importTheme = element<HTMLButtonElement>('import-theme');
  const removeTheme = element<HTMLButtonElement>('remove-theme');
  const themeFile = element<HTMLInputElement>('theme-file');
  const themeStatus = element('theme-status');
  const toolbarIcon = element<HTMLSelectElement>('toolbar-icon');
  const css = element<HTMLTextAreaElement>('css');
  const save = element<HTMLButtonElement>('save-css');
  const cssStatus = element('css-status');
  const search = element<HTMLInputElement>('search');
  const noResults = element('no-results');
  const draft = new CssDraft();

  // Mirror the Slack theme on this page. Cached so the popup opens already themed.
  function applyTheme(id: string) {
    const root = document.documentElement;
    const found = data.themes.find((t) => t.id === id);
    if (found) root.dataset.theme = found.id;
    else delete root.dataset.theme;
    root.style.setProperty('--theme-bg', found?.background ?? null);
    root.style.setProperty('--theme-accent', found?.accent ?? null);
    try {
      localStorage.setItem(THEME_KEY, id);
    } catch {}
  }
  try {
    applyTheme(localStorage.getItem(THEME_KEY) ?? '');
  } catch {}

  // Tabs: roving focus, arrow keys, last choice remembered per profile.
  const tabs = TABS.map((name) => element<HTMLButtonElement>(`tab-${name}`));
  function select(name: (typeof TABS)[number], focus = false) {
    TABS.forEach((other, index) => {
      const selected = other === name;
      tabs[index].setAttribute('aria-selected', String(selected));
      tabs[index].tabIndex = selected ? 0 : -1;
      element(`panel-${other}`).hidden = !selected;
    });
    if (focus) tabs[TABS.indexOf(name)].focus();
    try {
      localStorage.setItem(TAB_KEY, name);
    } catch {}
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(TABS[index]));
    tab.addEventListener('keydown', (event) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      select(TABS[(index + step + TABS.length) % TABS.length], true);
    });
  });
  let initial: string | null = null;
  try {
    initial = localStorage.getItem(TAB_KEY);
  } catch {}
  select((TABS as readonly string[]).includes(initial ?? '') ? (initial as (typeof TABS)[number]) : 'plugins');

  const rows = new Map<string, HTMLElement>();
  const workspaceFields = new Map<string, { mode: HTMLSelectElement; ids: HTMLInputElement; detail: HTMLElement }>();
  const fields: {
    id: (typeof RENDERERS)[number];
    key: string;
    setting: Inline;
    input: HTMLInputElement | HTMLSelectElement;
  }[] = [];
  for (const plugin of data.plugins) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('label');
    label.className = 'plugin';
    const input = document.createElement('input');
    input.id = plugin.id;
    input.type = 'checkbox';
    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'plugin__name';
    name.textContent = plugin.name;
    const description = document.createElement('span');
    description.className = 'plugin__description';
    description.textContent = plugin.description;
    text.append(name, description);
    label.append(input, text);
    const head = document.createElement('div');
    head.className = 'plugin__head';
    head.append(label);
    row.append(head);
    const entries = Object.entries(plugin.settings ?? {});
    {
      const panel = document.createElement('div');
      panel.className = 'plugin__settings';
      panel.id = `${plugin.id}-settings`;
      panel.hidden = true;
      const cog = document.createElement('button');
      cog.type = 'button';
      cog.className = 'cog';
      cog.title = `Configure ${plugin.name}`;
      cog.setAttribute('aria-label', cog.title);
      cog.setAttribute('aria-controls', panel.id);
      cog.setAttribute('aria-expanded', 'false');
      cog.append(cogIcon());
      cog.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        cog.setAttribute('aria-expanded', String(!panel.hidden));
      });
      head.append(cog);
      const reason = appWideReason(plugin.id);
      const workspaceHint = document.createElement('p');
      workspaceHint.className = 'hint';
      if (reason) {
        workspaceHint.textContent = `All workspaces. ${reason}`;
      } else {
        const workspaceLabel = document.createElement('label');
        workspaceLabel.className = 'setting';
        workspaceLabel.textContent = 'Run this plugin in';
        const mode = document.createElement('select');
        mode.className = 'input select';
        mode.append(new Option('All workspaces', 'all'), new Option('Selected workspaces', 'selected'));
        workspaceLabel.append(mode);
        panel.append(workspaceLabel);
        const detail = document.createElement('div');
        const idsLabel = document.createElement('label');
        idsLabel.className = 'setting';
        idsLabel.textContent = 'Workspace IDs (separated by commas)';
        const ids = document.createElement('input');
        ids.className = 'input';
        ids.placeholder = 'T0123456789, E0123456789';
        idsLabel.append(ids);
        const apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'button';
        apply.textContent = 'Save workspaces';
        const id = plugin.id as (typeof RENDERERS)[number];
        apply.addEventListener('click', () => {
          const value = ids.value.split(/[\s,]+/).filter(Boolean);
          if (value.some((workspaceId) => !WORKSPACE_ID.test(workspaceId))) {
            ids.setCustomValidity('Use the T… or E… ID from the workspace’s Slack URL.');
            ids.reportValidity();
            return;
          }
          void change({ property: 'pluginWorkspaces', id, value });
        });
        ids.addEventListener('input', () => ids.setCustomValidity(''));
        mode.addEventListener(
          'change',
          () => void change({ property: 'pluginWorkspaces', id, value: mode.value === 'all' ? null : [] }),
        );
        detail.append(idsLabel, apply);
        panel.append(detail);
        workspaceFields.set(plugin.id, { mode, ids, detail });
        workspaceHint.textContent =
          'Choose workspaces by name in Slack › Preferences › Slick. An empty selection runs nowhere.';
      }
      panel.append(workspaceHint);
      for (const [key, setting] of entries) {
        if (!inline(setting)) continue;
        const field = document.createElement('label');
        field.className = setting.type === 'boolean' ? 'plugin' : 'setting';
        let control: HTMLInputElement | HTMLSelectElement;
        if (setting.type === 'select') {
          control = document.createElement('select');
          control.className = 'input select';
          for (const option of setting.options) control.append(new Option(option.label, option.value));
        } else {
          control = document.createElement('input');
          if (setting.type === 'boolean') control.type = 'checkbox';
          else {
            control.className = 'input';
            control.type = setting.type;
          }
          if (setting.type === 'number') {
            if (setting.min !== undefined) control.min = String(setting.min);
            if (setting.max !== undefined) control.max = String(setting.max);
          } else if (setting.type === 'text' && setting.maxLength) control.maxLength = setting.maxLength;
        }
        const copy = document.createElement('span');
        const title = document.createElement('span');
        title.className = 'setting__name';
        title.textContent = setting.label;
        copy.append(title);
        if (setting.description) {
          const hint = document.createElement('span');
          hint.className = 'plugin__description';
          hint.textContent = setting.description;
          copy.append(hint);
        }
        field.append(...(setting.type === 'boolean' ? [control, copy] : [copy, control]));
        panel.append(field);
        fields.push({ id: plugin.id as (typeof RENDERERS)[number], key, setting, input: control });
      }
      if (entries.some(([, setting]) => !inline(setting))) {
        const more = document.createElement('p');
        more.className = 'hint';
        more.textContent = 'More settings in Slack › Preferences › Slick.';
        panel.append(more);
      }
      row.append(panel);
    }
    element('plugins').append(row);
    rows.set(plugin.id, row);
  }
  search.addEventListener('input', () => {
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const plugin of data.plugins) {
      const haystack = `${plugin.id} ${plugin.name} ${plugin.description}`.toLowerCase();
      const match = terms.every((term) => haystack.includes(term));
      rows.get(plugin.id)!.hidden = !match;
      if (match) shown++;
    }
    noResults.hidden = shown > 0;
    noResults.textContent = `No plugins match “${search.value.trim()}”.`;
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && search.value) {
      event.preventDefault();
      search.value = '';
      search.dispatchEvent(new Event('input'));
    }
  });

  function renderThemes(config: Record<string, unknown>) {
    theme.replaceChildren();
    for (const [value, label] of [
      ['', 'None'],
      ...data.themes.map((t) => [t.id, t.name]),
      ...Object.entries(importedThemes(config.importedThemes)).map(([id, t]) => [id, `${t.name || id} (imported)`]),
      ['custom', 'Custom CSS only'],
    ])
      theme.append(new Option(label, value));
  }
  renderThemes({});
  element('version').textContent = `Version ${data.version}`;
  element('tab-mode-hint').hidden = popup;

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const toast = (message: string) => {
    status.textContent = message;
    status.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => status.classList.remove('visible'), 2500);
  };
  const report = (message: string) => {
    errorText.textContent = message;
    error.hidden = false;
  };
  if (!api) {
    report('Open this page from the Slick button in the browser toolbar.');
    return;
  }
  const send: Send = (message) => api.runtime.sendMessage(message);
  let loaded = false;
  let busy = false;
  let generation = 0;
  function renderCss() {
    if (css.value !== draft.value) css.value = draft.value;
    save.disabled = !loaded || !draft.dirty || draft.saving;
    cssStatus.textContent = draft.saving ? 'Saving…' : draft.dirty ? 'Unsaved changes' : 'Saved';
  }
  async function refresh() {
    const current = ++generation;
    const [text, userCss] = await Promise.all([request(send, 'readSettings'), request(send, 'readUserCss')]);
    if (current !== generation) return;
    const config = parseSettings(text as string);
    renderThemes(config);
    paused.hidden = config.enabled !== false;
    theme.value = typeof config.theme === 'string' ? config.theme : '';
    if (theme.selectedIndex < 0) theme.value = '';
    applyTheme(theme.value);
    toolbarIcon.value = config.toolbarIcon === 'black' || config.toolbarIcon === 'white' ? config.toolbarIcon : 'auto';
    const plugins = record(config.plugins) ? config.plugins : {};
    const restrictions = record(config.pluginWorkspaces) ? config.pluginWorkspaces : {};
    for (const [id, { mode, ids, detail }] of workspaceFields) {
      const selected = workspaceSelection(restrictions[id]);
      mode.value = selected === null ? 'all' : 'selected';
      ids.value = selected?.join(', ') ?? '';
      detail.hidden = selected === null;
    }
    for (const id of RENDERERS) {
      const plugin = plugins[id];
      element<HTMLInputElement>(id).checked = record(plugin) && plugin.enabled === true;
    }
    for (const { id, key, setting, input } of fields) {
      const own = plugins[id];
      const value = coerceSetting(setting, record(own) ? own[key] : undefined);
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = value === true;
      else input.value = String(value);
    }
    loaded = true;
    settings.disabled = busy;
    theme.disabled = busy;
    importTheme.disabled = busy;
    removeTheme.disabled = busy;
    removeTheme.hidden = !importedThemes(config.importedThemes)[theme.value];
    toolbarIcon.disabled = busy;
    css.disabled = false;
    error.hidden = true;
    draft.remote(userCss as string);
    renderCss();
  }
  async function change(selected: Change) {
    busy = true;
    settings.disabled = true;
    theme.disabled = true;
    importTheme.disabled = true;
    removeTheme.disabled = true;
    toolbarIcon.disabled = true;
    error.hidden = true;
    try {
      await updateSetting(send, selected);
      await refresh();
      toast('Saved');
      return true;
    } catch {
      report("Couldn't save that setting. Your other settings weren't changed.");
      try {
        await refresh();
      } catch {
        /* Keep the error visible. */
      }
      return false;
    } finally {
      busy = false;
      settings.disabled = !loaded;
      theme.disabled = !loaded;
      importTheme.disabled = !loaded;
      removeTheme.disabled = !loaded;
      toolbarIcon.disabled = !loaded;
    }
  }
  element('resume-plugins').addEventListener('click', () => void change({ property: 'enabled', value: true }));
  toolbarIcon.addEventListener('change', () => void change({ property: 'toolbarIcon', value: toolbarIcon.value }));
  theme.addEventListener('change', () => {
    applyTheme(theme.value);
    void change({ property: 'theme', value: theme.value });
  });
  importTheme.addEventListener('click', () => themeFile.click());
  themeFile.addEventListener('change', async () => {
    const file = themeFile.files?.[0];
    themeFile.value = '';
    if (!file) return;
    importTheme.disabled = true;
    try {
      if (file.size > MAX_TEXT) throw new Error('Theme files must be smaller than 256 KiB.');
      const value = parseThemeJson(await file.text(), file.name);
      const saved = await change({ property: 'importTheme', id: `imported:${crypto.randomUUID()}`, value });
      themeStatus.textContent = saved ? `Imported ${value.name}.` : 'Could not save the theme.';
    } catch (cause) {
      themeStatus.textContent = cause instanceof Error ? cause.message : 'Could not import the theme.';
    } finally {
      importTheme.disabled = !loaded || busy;
    }
  });
  removeTheme.addEventListener('click', async () => {
    const saved = await change({ property: 'removeTheme', id: theme.value });
    themeStatus.textContent = saved ? 'Removed imported theme.' : 'Could not remove the theme.';
  });
  for (const id of RENDERERS) {
    const input = element<HTMLInputElement>(id);
    input.addEventListener('change', () => {
      if (input.checked && (SLACK_ACCESS_PLUGINS as readonly string[]).includes(id))
        void api.permissions?.request(SLACK_ACCESS).catch(() => {});
      void change({ property: 'plugin', id, value: input.checked });
    });
  }
  for (const { id, key, setting, input } of fields)
    input.addEventListener('change', () => {
      const raw =
        input instanceof HTMLInputElement && input.type === 'checkbox'
          ? input.checked
          : setting.type === 'number'
            ? Number(input.value)
            : input.value;
      void change({
        property: 'pluginSetting',
        id,
        key,
        value: coerceSetting(setting, raw) as boolean | number | string,
      });
    });
  css.maxLength = MAX_TEXT;
  css.addEventListener('input', () => {
    draft.edit(css.value);
    renderCss();
  });
  save.addEventListener('click', async () => {
    error.hidden = true;
    const pending = draft.save(send);
    renderCss();
    try {
      await pending;
      await refresh();
    } catch {
      report("Couldn't save your CSS. Your changes are still here.");
    } finally {
      renderCss();
    }
  });
  element('open-editor').addEventListener('click', async () => {
    try {
      if ((await request(send, 'openCssEditor')) !== true) throw new Error('Not opened');
      window.close();
    } catch {
      report("Couldn't open a new tab.");
    }
  });
  for (const mode of ['bypass', 'resume', 'safe-mode'] as const) {
    const button = element<HTMLButtonElement>(mode);
    button.addEventListener('click', async () => {
      button.disabled = true;
      error.hidden = true;
      try {
        await recover(api, mode);
        toast('Reloading Slack…');
      } catch {
        report('Switch to a Slack tab, then open Slick from the toolbar to use this.');
      } finally {
        button.disabled = false;
      }
    });
  }
  const browser = api;
  const pluginStatus = element('plugin-status');
  const installPlugin = element<HTMLButtonElement>('install-plugin');
  const pluginFile = element<HTMLInputElement>('plugin-file');
  const permission = { permissions: ['userScripts'] };
  const stored = async () => installedPlugins((await browser.storage.local.get(USER_PLUGINS_KEY))[USER_PLUGINS_KEY]);
  let allowed = false;
  async function renderUserPlugins() {
    const plugins = await stored();
    element('user-plugins').replaceChildren(
      ...Object.values(plugins).map((plugin) => {
        const row = document.createElement('div');
        row.className = 'row setting';
        const text = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'setting__name';
        name.textContent = plugin.name;
        const description = document.createElement('div');
        description.className = 'hint';
        description.textContent = plugin.description || 'User plugin';
        text.append(name, description);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'button';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove ${plugin.name}`);
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          await request(send, 'blob.clear', [`plugin:${plugin.id}`]).catch(() => {});
          const rest = await stored();
          delete rest[plugin.id];
          await browser.storage.local.set({ [USER_PLUGINS_KEY]: rest });
          pluginStatus.textContent = `Removed ${plugin.name}. Reload Slack to finish.`;
        });
        row.append(text, remove);
        return row;
      }),
    );
    if (!browser.runtime.getManifest?.().optional_permissions?.includes('userScripts')) {
      installPlugin.hidden = true;
      pluginStatus.textContent = 'User plugins aren’t available in the Firefox Add-ons version of Slick.';
      return;
    }
    allowed = (await browser.permissions?.contains(permission)) === true;
    installPlugin.textContent = allowed ? 'Install plugin file…' : 'Allow user plugins';
    if (allowed && !userScripts(browser))
      pluginStatus.textContent =
        'Turn on “Allow User Scripts” in Slick’s extension details (Developer mode in chrome://extensions on Chrome 137 and older), then reopen this page.';
  }
  installPlugin.addEventListener('click', () => {
    if (allowed) return pluginFile.click();
    // Firefox only prompts from inside the click.
    void browser.permissions?.request(permission).then(renderUserPlugins, () => {
      pluginStatus.textContent = 'This browser can’t run user plugins.';
    });
  });
  pluginFile.addEventListener('change', async () => {
    const file = pluginFile.files?.[0];
    pluginFile.value = '';
    if (!file) return;
    try {
      const plugin = parsePluginFile(await file.text());
      if ((RENDERERS as readonly string[]).includes(plugin.id)) throw new Error(`${plugin.id} is built into Slick.`);
      await browser.storage.local.set({ [USER_PLUGINS_KEY]: { ...(await stored()), [plugin.id]: plugin } });
      pluginStatus.textContent = `Installed ${plugin.name}. Reload Slack to run it.`;
    } catch (cause) {
      pluginStatus.textContent = cause instanceof Error ? cause.message : 'Could not install the plugin.';
    }
  });
  void renderUserPlugins();
  const reload = () => void refresh().catch(() => report("Couldn't load your settings."));
  element('retry').addEventListener('click', reload);
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (SETTINGS_KEY in changes || CSS_KEY in changes)) reload();
    if (area === 'local' && USER_PLUGINS_KEY in changes) void renderUserPlugins();
  });
  reload();
}

export const optionsBrowser = () => extensionBrowser() as OptionsBrowser | undefined;
