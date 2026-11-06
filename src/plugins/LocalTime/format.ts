export const localTime = (tz: unknown, twelveHour: boolean, now: number): string => {
  if (typeof tz !== 'string' || !tz) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: twelveHour,
    }).format(now);
  } catch {
    return '';
  }
};
