// Parse Slack's `who_can_post` pref and decide whether the bot needs adding.
// Pure so a wrong pref shape fails in tests, not in a channel.

export type PrefValue = { type?: unknown[]; user?: unknown[]; subteam?: unknown[] };
export type ChannelPref = { pref_value?: PrefValue };

const RESTRICTED = new Set(['admin', 'owner', 'org_admin']);

export function slackPropagationDelay(attempt: number): number {
  return attempt <= 2 ? 500 : 2_000;
}

export function parseWhoCanPost(raw: unknown): ChannelPref {
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if (record.pref_value && typeof record.pref_value === 'object') return record as ChannelPref;
    if (record.prefs && typeof record.prefs === 'object') {
      return parseWhoCanPost((record.prefs as Record<string, unknown>).who_can_post);
    }
    if (Array.isArray(record.type) || Array.isArray(record.user)) return { pref_value: record as PrefValue };
  }
  if (typeof raw !== 'string' || !raw.trim()) return {};

  const type: string[] = [];
  const user: string[] = [];
  const subteam: string[] = [];
  for (const part of raw.split(',')) {
    const sep = part.indexOf(':');
    if (sep <= 0) continue;
    const kind = part.slice(0, sep).trim();
    const id = part.slice(sep + 1).trim();
    if (!id) continue;
    if (kind === 'type') type.push(id);
    else if (kind === 'user') user.push(id);
    else if (kind === 'subteam') subteam.push(id);
  }
  return { pref_value: { type, user, subteam } };
}

export function prefAllowsBot(pref: ChannelPref | undefined, botUserId: string): boolean {
  const value = pref?.pref_value;
  if (!value || typeof value !== 'object') return true;
  const types = Array.isArray(value.type) ? value.type.map(String) : [];
  const users = Array.isArray(value.user) ? value.user.map(String) : [];
  if (users.includes(botUserId)) return true;
  return !types.some((type) => RESTRICTED.has(type));
}

export function postingPrefWithBot(pref: ChannelPref | undefined, botUserId: string): string {
  const value = pref?.pref_value;
  if (!value || typeof value !== 'object') return '';
  const parts: string[] = [];
  for (const type of Array.isArray(value.type) ? value.type : []) parts.push(`type:${String(type)}`);
  for (const user of Array.isArray(value.user) ? value.user : []) parts.push(`user:${String(user)}`);
  for (const subteam of Array.isArray(value.subteam) ? value.subteam : []) parts.push(`subteam:${String(subteam)}`);
  if (!parts.includes(`user:${botUserId}`)) parts.push(`user:${botUserId}`);
  return parts.join(',');
}

export function apiErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const json = /failed: ({[\s\S]*})$/.exec(message)?.[1];
  if (json) {
    try {
      const parsed = JSON.parse(json) as { error?: unknown };
      if (typeof parsed.error === 'string') return parsed.error;
    } catch {}
  }
  return message;
}
