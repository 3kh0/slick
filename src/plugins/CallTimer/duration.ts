const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

export function formatDuration(ms: number, human = false): string {
  ms = Math.max(ms, 0);
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  const seconds = Math.floor((ms % MINUTE) / 1000);

  const pad = (n: number) => (human ? String(n) : String(n).padStart(2, '0'));
  const unit = (s: string) => (human ? s : '');
  const showHours = days > 0 || hours > 0;
  const showMinutes = showHours || minutes > 0 || !human;

  const parts = [
    showHours && `${pad(hours)}${unit('h')}`,
    showMinutes && `${pad(minutes)}${unit('m')}`,
    `${pad(seconds)}${unit('s')}`,
  ].filter(Boolean);
  return (days > 0 ? `${days}d ` : '') + parts.join(human ? ' ' : ':');
}
