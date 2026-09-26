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

function mount(api: OptionsBrowser | undefined) {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const error = element('error');
  const status = element('status');
  const settings = element<HTMLFieldSetElement>('settings');
  const enabled = element<HTMLInputElement>('enabled');
  const theme = element<HTMLSelectElement>('theme');
  const css = element<HTMLTextAreaElement>('css');
  const save = element<HTMLButtonElement>('save-css');
  const cssStatus = element('css-status');
  const draft = new CssDraft();
  const pluginList = element('plugins');
  for (const id of RENDERERS) {
    const label = document.createElement('label');
    label.className = 'switch';
    const name = document.createElement('span');
    name.textContent = id;
    const input = document.createElement('input');
    input.id = id;
    input.type = 'checkbox';
    label.append(name, input);
    pluginList.append(label);
  }
  const report = (message: string) => {
    error.textContent = message;
    error.hidden = false;
  };
  if (!api) {
    report('Firefox extension APIs are unavailable. Open this page from the installed extension.');
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
    enabled.checked = config.enabled !== false;
    theme.value = typeof config.theme === 'string' ? config.theme : '';
    if (theme.selectedIndex < 0) theme.value = '';
    const plugins = record(config.plugins) ? config.plugins : {};
    for (const id of RENDERERS) {
      const plugin = plugins[id];
      element<HTMLInputElement>(id).checked = record(plugin) && plugin.enabled === true;
    }
    loaded = true;
    settings.disabled = busy;
    css.disabled = false;
    draft.remote(userCss as string);
    renderCss();
  }
  async function change(selected: Change) {
    busy = true;
    settings.disabled = true;
    error.hidden = true;
    status.textContent = 'Saving setting…';
    try {
      await updateSetting(send, selected);
      await refresh();
      status.textContent = 'Setting saved.';
    } catch {
      status.textContent = '';
      report('Could not save or confirm the setting. Retry; existing settings were not replaced with defaults.');
      try {
        await refresh();
      } catch {
        /* Keep the error visible. */
      }
    } finally {
      busy = false;
      settings.disabled = !loaded;
    }
  }
  enabled.addEventListener('change', () => void change({ property: 'enabled', value: enabled.checked }));
  theme.addEventListener('change', () => void change({ property: 'theme', value: theme.value }));
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
      report('Could not save or confirm CSS. Your draft is still here; retry when the extension is available.');
    } finally {
      renderCss();
    }
  });
  element('open-editor').addEventListener('click', async () => {
    try {
      if ((await request(send, 'openCssEditor')) !== true) throw new Error('Not opened');
    } catch {
      report('Could not open the full editor.');
    }
  });
  for (const mode of ['bypass', 'resume', 'safe-mode'] as const) {
    const button = element<HTMLButtonElement>(mode);
    button.addEventListener('click', async () => {
      button.disabled = true;
      error.hidden = true;
      try {
        await recover(api, mode);
        status.textContent = 'Recovery applied to the active Slack tab; reloading.';
      } catch {
        report(
          'Recovery not confirmed. Use the action popup on an active app.slack.com/client tab. The extension needs scripting and https://app.slack.com/* host permission.',
        );
      } finally {
        button.disabled = false;
      }
    });
  }
  const reload = () =>
    void refresh().catch(() => report('Could not load settings. Your unsaved CSS is preserved. Retry loading.'));
  element('retry').addEventListener('click', reload);
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (SETTINGS_KEY in changes || CSS_KEY in changes)) reload();
  });
  reload();
}

if (typeof document !== 'undefined') mount(extensionBrowser() as OptionsBrowser | undefined);
