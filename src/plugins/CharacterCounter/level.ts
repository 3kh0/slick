export type Level = 'normal' | 'warn' | 'high' | 'danger';

export function levelOf(length: number, max: number): Level {
  if (max <= 0) return 'normal';
  const percent = (length / max) * 100;
  if (percent < 50) return 'normal';
  if (percent < 75) return 'warn';
  if (percent < 90) return 'high';
  return 'danger';
}
