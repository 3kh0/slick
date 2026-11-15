import { Store } from '../store.ts';

export type SettingsTab = {
  id: string;
  label: string;
  icon?: string | React.ReactElement;
  render: () => React.ReactNode;
};

export const settingsTabs = new Store<readonly SettingsTab[]>([]);

export function addSettingsTab(tab: SettingsTab): () => void {
  settingsTabs.update((tabs) => [...tabs.filter((existing) => existing.id !== tab.id), tab]);
  return () => settingsTabs.update((tabs) => tabs.filter((existing) => existing !== tab));
}

/** Custom React a plugin renders on its own detail page, keyed by plugin id. */
export type PluginPanel = () => React.ReactNode;

export const pluginPanels = new Store<Readonly<Record<string, PluginPanel>>>({});

export function setPluginPanel(id: string, render: PluginPanel): () => void {
  pluginPanels.update((panels) => ({ ...panels, [id]: render }));
  return () =>
    pluginPanels.update((panels) => {
      if (panels[id] !== render) return panels;
      const next = { ...panels };
      delete next[id];
      return next;
    });
}
