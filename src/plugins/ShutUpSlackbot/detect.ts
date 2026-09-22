// Recognizing Slackbot's slash-command registration notices. Shared by both
// halves so they agree (else a notice is silenced but not marked read, or the
// reverse). Heuristics over English prose Slack can reword at any time.

/** Slack mrkdwn links: `<url|label>` and `<url>`. */
export function decodeMrkdwn(text: unknown): string {
  return String(text ?? '')
    .replace(/<([^>|]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1');
}

export type NotificationLike = {
  title?: unknown;
  subtitle?: unknown;
  body?: unknown;
  content?: unknown;
  message?: unknown;
};

export function notificationText(options: unknown): string {
  if (!options || typeof options !== 'object') return decodeMrkdwn(options);
  const fields = options as NotificationLike;
  return decodeMrkdwn(
    [fields.title, fields.subtitle, fields.body, fields.content, fields.message].filter(Boolean).join(' '),
  );
}

const MENTIONS_SLASH_COMMANDS = /slash[-_\s]+commands?/i;
const LOOKS_LIKE_A_COMMAND = /(^|\s)`?\/[a-z0-9_-]+`?/i;
const COMMAND_PHRASING = /\b(has been using|same command|when people enter)\b/i;
const REGISTRATION_VERB = /\b(new|added|created|registered|registration|installed|enabled|configured)\b/i;

// Needs both a slash-command signal and a registration verb; either alone
// matches far too much ("new" is in most Slackbot messages, and a user typing
// a `/word` in a DM must not be silenced).
export function isSlashCommandNotice(text: string): boolean {
  if (!text) return false;
  const aboutSlashCommands =
    MENTIONS_SLASH_COMMANDS.test(text) || (LOOKS_LIKE_A_COMMAND.test(text) && COMMAND_PHRASING.test(text));
  return aboutSlashCommands && REGISTRATION_VERB.test(text);
}

const SLACKBOT_IDS = new Set(['USLACKBOT', 'USLACK']);

// Exact name match: suppression is silent and destructive, so an app called
// "Slackbot Deluxe" must not count.
export function isSlackbot(userId: unknown, name?: unknown): boolean {
  if (typeof userId === 'string' && SLACKBOT_IDS.has(userId)) return true;
  return /^slackbot$/i.test(String(name ?? '').trim());
}
