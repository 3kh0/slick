// Recognizing Slackbot's slash-command registration notices.
//
// Shared by both halves on purpose: the main half tests a native notification's
// text, the renderer tests a message in the store, and the two must agree or a
// notice gets silenced but not marked read (or the reverse).
//
// Everything here is a heuristic over English prose Slack can reword at any
// time, which is why it is isolated and tested rather than inlined twice.

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

/** Every text field a native notification might carry, flattened. */
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

/**
 * A slash-command registration notice needs two things: some sign it is about
 * slash commands, and a registration verb. Either half alone matches far too
 * much -- "new" appears in most Slackbot messages, and someone typing a `/word`
 * in a DM should not be silenced.
 */
export function isSlashCommandNotice(text: string): boolean {
  if (!text) return false;
  const aboutSlashCommands =
    MENTIONS_SLASH_COMMANDS.test(text) || (LOOKS_LIKE_A_COMMAND.test(text) && COMMAND_PHRASING.test(text));
  return aboutSlashCommands && REGISTRATION_VERB.test(text);
}

const SLACKBOT_IDS = new Set(['USLACKBOT', 'USLACK']);

/**
 * Stricter than v1, which tested `/(^|\s)slackbot(\s|$)/` and so also matched
 * an app called "Slackbot Deluxe". Suppressing a notification is destructive
 * and silent, so the name has to actually be Slackbot.
 */
export function isSlackbot(userId: unknown, name?: unknown): boolean {
  if (typeof userId === 'string' && SLACKBOT_IDS.has(userId)) return true;
  return /^slackbot$/i.test(String(name ?? '').trim());
}
