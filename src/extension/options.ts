import { extensionBrowser, MAX_TEXT, RENDERERS, record, validMethodResponse, validRequest } from './rpc.ts';
import type { ExtensionBrowser, Method } from './rpc.ts';
import { CSS_KEY, SETTINGS_KEY } from './storage.ts';

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
  | { property: 'toolbarIcon'; value: string }
  | { property: 'plugin'; id: (typeof RENDERERS)[number]; value: boolean };

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
    if (change.property === 'plugin') {
      if (config.plugins !== undefined && !record(config.plugins)) throw new Error('Invalid plugins');
      const plugins = record(config.plugins) ? config.plugins : {};
      const prior = plugins[change.id];
      if (prior !== undefined && !record(prior)) throw new Error('Invalid plugin');
      config.plugins = { ...plugins, [change.id]: { ...(record(prior) ? prior : {}), enabled: change.value } };
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
  plugins: { id: string; name: string; description: string }[];
  themes: { id: string; name: string; background: string | null; accent: string | null }[];
  version: string;
};

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
  for (const plugin of data.plugins) {
    const label = document.createElement('label');
    label.className = 'row plugin';
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
    element('plugins').append(label);
    rows.set(plugin.id, label);
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

  for (const [value, label] of [['', 'None'], ...data.themes.map((t) => [t.id, t.name]), ['custom', 'Custom']]) {
    theme.append(new Option(label, value));
  }
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
    report('Open this page from the Slick button in the Firefox toolbar.');
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
    paused.hidden = config.enabled !== false;
    theme.value = typeof config.theme === 'string' ? config.theme : '';
    if (theme.selectedIndex < 0) theme.value = '';
    applyTheme(theme.value);
    toolbarIcon.value = config.toolbarIcon === 'black' || config.toolbarIcon === 'white' ? config.toolbarIcon : 'auto';
    const plugins = record(config.plugins) ? config.plugins : {};
    for (const id of RENDERERS) {
      const plugin = plugins[id];
      element<HTMLInputElement>(id).checked = record(plugin) && plugin.enabled === true;
    }
    loaded = true;
    settings.disabled = busy;
    theme.disabled = busy;
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
    toolbarIcon.disabled = true;
    error.hidden = true;
    try {
      await updateSetting(send, selected);
      await refresh();
      toast('Saved');
    } catch {
      report("Couldn't save that setting. Your other settings weren't changed.");
      try {
        await refresh();
      } catch {
        /* Keep the error visible. */
      }
    } finally {
      busy = false;
      settings.disabled = !loaded;
      theme.disabled = !loaded;
      toolbarIcon.disabled = !loaded;
    }
  }
  element('resume-plugins').addEventListener('click', () => void change({ property: 'enabled', value: true }));
  toolbarIcon.addEventListener('change', () => void change({ property: 'toolbarIcon', value: toolbarIcon.value }));
  theme.addEventListener('change', () => {
    applyTheme(theme.value);
    void change({ property: 'theme', value: theme.value });
  });
  for (const id of RENDERERS) {
    const input = element<HTMLInputElement>(id);
    input.addEventListener('change', () => void change({ property: 'plugin', id, value: input.checked }));
  }
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
  const reload = () => void refresh().catch(() => report("Couldn't load your settings."));
  element('retry').addEventListener('click', reload);
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (SETTINGS_KEY in changes || CSS_KEY in changes)) reload();
  });
  reload();
}

export const optionsBrowser = () => extensionBrowser() as OptionsBrowser | undefined;
