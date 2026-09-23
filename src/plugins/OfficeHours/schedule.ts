import type { ScheduleRule } from '../../shared/settings.ts';

const MAX_CHAIN_DAYS = 7;

function at(day: Date, time: string, dayOffset = 0): Date {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + dayOffset, hours, minutes);
}

/** Windows of `rule` that start on the day before, the day of, or the day after `day`. */
function windowsAround(rule: ScheduleRule, day: Date): { start: Date; end: Date }[] {
  const windows = [];
  for (const offset of [-1, 0, 1]) {
    const start = at(day, rule.start, offset);
    if (!rule.days.includes(start.getDay())) continue;
    // An end at or before the start runs into the next day.
    const end = at(day, rule.end, offset + (rule.end <= rule.start ? 1 : 0));
    windows.push({ start, end });
  }
  return windows;
}

/**
 * When the `status` window covering `now` ends, or undefined outside one.
 * Back-to-back windows (Fri 17:00-00:00 then all weekend) merge into one.
 */
export function activeUntil(rules: readonly ScheduleRule[], status: string, now: Date): Date | undefined {
  const matching = rules.filter((rule) => rule.status === status && rule.days.length);
  let end: Date | undefined;
  for (const rule of matching) {
    for (const window of windowsAround(rule, now)) {
      if (window.start <= now && now < window.end && (!end || window.end > end)) end = window.end;
    }
  }
  if (!end) return undefined;

  const limit = now.getTime() + MAX_CHAIN_DAYS * 86_400_000;
  for (let extended = true; extended && end.getTime() < limit;) {
    extended = false;
    for (const rule of matching) {
      for (const window of windowsAround(rule, end)) {
        if (window.start <= end && window.end > end) {
          end = window.end;
          extended = true;
        }
      }
    }
  }
  return end.getTime() > limit ? new Date(limit) : end;
}
