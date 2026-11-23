export const ICONS = [
  { id: 'slick', label: 'Slick', author: 'Echo' },
  { id: 'inverted', label: 'Slick Inverted', author: 'JosTheDude' },
  { id: 'slack', label: 'Slack', author: 'Slack' },
  { id: 'slack-inverted', label: 'Slack Inverted', author: 'Slack' },
  { id: 'pride', label: 'Pride', author: 'JosTheDude' },
  { id: 'pride-inverted', label: 'Pride Inverted', author: 'JosTheDude' },
] as const;

export const ICON_PAIRS = [
  { id: 'slick', light: 'slick', dark: 'inverted', label: 'Slick', author: 'Echo & JosTheDude' },
  { id: 'slack', light: 'slack', dark: 'slack-inverted', label: 'Slack', author: 'Slack' },
  { id: 'pride', light: 'pride', dark: 'pride-inverted', label: 'Pride', author: 'JosTheDude' },
] as const;

export type IconPair = (typeof ICON_PAIRS)[number];

export const SLACK_ICONS = new Set(['slack', 'slack-inverted']);

export type Theme = 'light' | 'dark';
export type ThemeState = { dark: boolean; theme: Theme };
export type ImportResult = 'saved' | 'cancelled' | 'unreadable' | 'failed';

export function pairFor(icon: string): IconPair | null {
  return ICON_PAIRS.find((pair) => pair.light === icon || pair.dark === icon) ?? null;
}

export function iconLabel(icon: string): string {
  return ICONS.find((entry) => entry.id === icon)?.label ?? icon;
}

export function activeIcon(icon: string, autoInvert: boolean, systemDark: boolean): string {
  if (!autoInvert) return icon;
  const pair = pairFor(icon);
  return pair ? (systemDark ? pair.dark : pair.light) : icon;
}
