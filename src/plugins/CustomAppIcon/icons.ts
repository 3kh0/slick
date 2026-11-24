export const ICONS = [
  { id: 'slick', label: 'Slick', author: 'Echo' },
  { id: 'inverted', label: 'Slick Inverted', author: 'JosTheDude' },
  { id: 'slack', label: 'Slack', author: 'Slack' },
  { id: 'slack-inverted', label: 'Slack Inverted', author: 'Slack' },
  { id: 'pride', label: 'Pride', author: 'JosTheDude' },
  { id: 'pride-inverted', label: 'Pride Inverted', author: 'JosTheDude' },
] as const;

export const SLACK_ICONS = new Set<string>(['slack', 'slack-inverted']);

export type Theme = 'light' | 'dark';
export type ImportResult = 'saved' | 'cancelled' | 'unreadable' | 'failed';
