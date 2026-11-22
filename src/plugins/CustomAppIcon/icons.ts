export const ICONS = [
  { id: 'slick', label: 'Slick', author: 'Echo' },
  { id: 'inverted', label: 'Inverted', author: 'JosTheDude' },
  { id: 'pride', label: 'Pride', author: 'JosTheDude' },
  { id: 'pride-inverted', label: 'Pride Inverted', author: 'JosTheDude' },
  { id: 'molten', label: 'Molten', author: 'Echo' },
] as const;

export type ImportResult = 'saved' | 'cancelled' | 'unreadable' | 'failed';
