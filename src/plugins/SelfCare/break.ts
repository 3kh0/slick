export const BREAK_KEY = 'until';
export const MAX_MINUTES = 10080;

export function breakEnd(minutes: unknown, now = Date.now()): number {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    throw new Error('Choose a break between 1 minute and 7 days.');
  }
  return now + Math.round(minutes * 60_000);
}

export function storedEnd(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function countdown(until: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const time = [hours, minutes, seconds % 60].map((part) => String(part).padStart(2, '0')).join(':');
  return days ? `${days}d ${time}` : time;
}

export const NOTIFICATION_THUNKS = [
  'showNotification',
  'showSavedItemNotification',
  'showApprovalItemNotification',
  'showHuddleNotification',
  'showHuddleRecommendNotification',
  'showHuddleRequestEntryResultNotification',
  'showHuddleMissedNotification',
  'showJustInTimeCalendarNotification',
  'showActivitiesSummaryNotification',
  'showSeasonalJanuaryDelightWebPushNotification',
  'showOnboardingTasksReminderNotification',
  'showPrejoinDmWelcomePartyWebPushNotification',
  'showDesktopNotificationForUnjoinedChannelMention',
  'showDesktopNotificationForSlackSystemAlert',
  'playHuddleInviteSound',
  'playHuddleNewRequesterSound',
];

export function notificationGuard<T extends (...args: any[]) => any>(original: T, active: () => boolean): T {
  return function (this: unknown, ...args: unknown[]) {
    return active() ? () => Promise.resolve() : original.apply(this, args);
  } as T;
}
