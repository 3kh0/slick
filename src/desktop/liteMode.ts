// Pure helpers for lite mode (lite.ts), kept free of electron for the unit tests.

export const LITE_ARG = '--slick-lite';

const SLACK_HOST = /(^|\.)(slack\.com|slack-edge\.com|slackb\.com|slack-imgs\.com|slack-files\.com|slack-msgs\.com)$/;
// SSO has to finish in-app so the session cookie lands in this profile.
const SSO_HOST = /(^|\.)(accounts\.google\.com|login\.microsoftonline\.com|okta\.com|appleid\.apple\.com)$/;

function hostMatches(pattern: RegExp, url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && pattern.test(parsed.hostname);
  } catch {
    return false;
  }
}

export const isSlackUrl = (url: string) => hostMatches(SLACK_HOST, url);
export const isSsoUrl = (url: string) => hostMatches(SSO_HOST, url);

export function liteRequested(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
  return argv.includes('--lite') || env.SLICK_LITE === '1';
}

/** Drops the app and Electron tokens so the web client takes its browser path. */
export function liteUserAgent(userAgent: string): string {
  return userAgent
    .replace(/ (?:Slack|Slick|slick|Electron)\/\S+/g, '')
    .replace(/ (?:Sonic|Slack_SSB\/\S+)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Slack's title prefix: "(3) …" for a count, "* …" or "! …" for unread without one. */
export function badgeFromTitle(title: string): number {
  const counted = /^\((\d+)\)/.exec(title);
  if (counted) return Number(counted[1]);
  return /^[!*]/.test(title) ? 1 : 0;
}
