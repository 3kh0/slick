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
