// A short, copyable log of the current huddle attempt: join steps, Slack API
// failures and the Chime SDK's own messages. The call window shows it when a
// join fails or a call drops, so it can be pasted into a bug report. Nothing
// here leaves the page on its own.

import { createValueStore } from './valueStore.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  at: number;
  level: LogLevel;
  message: string;
}

const DEFAULT_LIMIT = 400;
const MAX_MESSAGE_CHARS = 2_000;
// Slack tokens should never be logged, but scrub them anyway in case an error message echoes one.
const SLACK_TOKEN = /xox[a-z]-[A-Za-z0-9-]+/g;
const REDACTED = '[redacted]';

/** Message plus stack (minus its repeated first line), for "x is not a constructor"-style errors. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const stack = error.stack?.split('\n').slice(1).join('\n');
  return stack ? `${error.name}: ${error.message}\n${stack}` : `${error.name}: ${error.message}`;
}

function formatTime(at: number): string {
  return new Date(at).toISOString().slice(11, 23);
}

export function createCallLog({ limit = DEFAULT_LIMIT, now = Date.now } = {}) {
  const entries = createValueStore<LogEntry[]>([]);
  const secrets = new Set<string>();

  const scrub = (text: string): string => {
    let clean = text.replace(SLACK_TOKEN, REDACTED);
    for (const secret of secrets) clean = clean.split(secret).join(REDACTED);
    return clean.length > MAX_MESSAGE_CHARS ? `${clean.slice(0, MAX_MESSAGE_CHARS)}… (truncated)` : clean;
  };

  function add(level: LogLevel, message: string): void {
    const entry = { at: now(), level, message: scrub(message) };
    entries.update((current) => [...current, entry].slice(-limit));
  }

  /** Never show this value (e.g. the Chime join token); also scrubs lines already logged. */
  function redact(secret: string): void {
    // Very short strings would blank out ordinary words.
    if (secret.length < 8) return;
    secrets.add(secret);
    entries.update((current) => current.map((entry) => ({ ...entry, message: scrub(entry.message) })));
  }

  /** Plain text for the clipboard: a header line, then one line per entry. */
  function format(header = ''): string {
    const lines = entries
      .get()
      .map((entry) => `${formatTime(entry.at)} ${entry.level.toUpperCase().padEnd(5)} ${entry.message}`);
    return header ? [header, ...lines].join('\n') : lines.join('\n');
  }

  return {
    entries,
    add,
    redact,
    format,
    clear: () => entries.set([]),
  };
}

export type CallLog = ReturnType<typeof createCallLog>;
