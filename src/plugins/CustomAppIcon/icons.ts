export const ICONS = [
  { id: 'slick', label: 'Slick', author: 'Echo' },
  { id: 'slack', label: 'Slack', author: 'Slack' },
  { id: 'slack-inverted', label: 'Slack Inverted', author: 'Slack' },
  { id: 'inverted', label: 'Slick Inverted', author: 'JosTheDude' },
  { id: 'pride', label: 'Pride', author: 'JosTheDude' },
  { id: 'pride-inverted', label: 'Pride Inverted', author: 'JosTheDude' },
] as const;

export type ImportResult = 'saved' | 'cancelled' | 'unreadable' | 'failed';
