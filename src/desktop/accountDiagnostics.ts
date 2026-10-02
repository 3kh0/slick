import fs from 'node:fs';
import path from 'node:path';
import { settingsDir } from './paths.ts';

/** Only process-local numeric IDs, counts and fixed diagnostic classifications. */
export type AccountDiagnosticDetails = {
  senderId?: number;
  webContentsId?: number;
  clientCount?: number;
  accountCount?: number;
  cookieCount?: number;
  handoffCount?: number;
  busy?: boolean;
  destroyed?: boolean;
  allowed?: boolean;
  success?: boolean;
  hasHandoff?: boolean;
  action?: 'switch' | 'reset' | 'signin' | 'capture' | 'forget';
  source?: 'load-url' | 'navigation' | 'redirect' | 'popup' | 'ipc';
  stage?: 'start' | 'park' | 'clear' | 'mutate' | 'load' | 'complete' | 'failed';
  reason?: 'busy' | 'destroyed' | 'blocked' | 'invalid' | 'io' | 'failed';
};

const numericKeys = [
  'senderId',
  'webContentsId',
  'clientCount',
  'accountCount',
  'cookieCount',
  'handoffCount',
] as const;
const booleanKeys = ['busy', 'destroyed', 'allowed', 'success', 'hasHandoff'] as const;
const enums = {
  action: ['switch', 'reset', 'signin', 'capture', 'forget'],
  source: ['load-url', 'navigation', 'redirect', 'popup', 'ipc'],
  stage: ['start', 'park', 'clear', 'mutate', 'load', 'complete', 'failed'],
  reason: ['busy', 'destroyed', 'blocked', 'invalid', 'io', 'failed'],
} as const;

export const ACCOUNT_LOG_MAX_BYTES = 512 * 1024;

export function isAccountDiagnosticDetails(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Never stringify caller data, call getters, or retain arbitrary strings. */
export function formatAccountEvent(event: unknown, details: unknown): string | null {
  try {
    if (typeof event !== 'string' || /^[a-z][a-z0-9.-]{0,80}$/.exec(event)?.[0] !== event) return null;
    if (!isAccountDiagnosticDetails(details)) return null;
    const sanitized: AccountDiagnosticDetails = {};
    const value = (key: string): unknown => Object.getOwnPropertyDescriptor(details, key)?.value;
    for (const key of numericKeys) {
      const entry = value(key);
      if (typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0) sanitized[key] = entry;
    }
    for (const key of booleanKeys) {
      const entry = value(key);
      if (typeof entry === 'boolean') sanitized[key] = entry;
    }
    for (const key of Object.keys(enums) as (keyof typeof enums)[]) {
      const entry = value(key);
      if (typeof entry === 'string' && (enums[key] as readonly string[]).includes(entry)) {
        // Assignment remains restricted to the per-key enum above.
        Object.defineProperty(sanitized, key, { value: entry, enumerable: true });
      }
    }
    return `${JSON.stringify({ timestamp: new Date().toISOString(), event, details: sanitized })}\n`;
  } catch {
    return null;
  }
}

/** Directory injection keeps tests away from real settings and profiles. */
export function createAccountDiagnosticLogger(directory: () => string) {
  return (event: unknown, details: unknown): void => {
    try {
      const line = formatAccountEvent(event, details);
      if (!line) return;
      const dir = directory();
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, 'account-switcher.log');
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
      }
      if (size + Buffer.byteLength(line) > ACCOUNT_LOG_MAX_BYTES) {
        const backup = `${file}.1`;
        fs.rmSync(backup, { force: true });
        // Truncate oversized pre-existing logs so even the backup is bounded.
        if (size > ACCOUNT_LOG_MAX_BYTES) fs.truncateSync(file, ACCOUNT_LOG_MAX_BYTES);
        fs.renameSync(file, backup);
      }
      fs.appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // Diagnostics must never interrupt account transitions or log IO errors.
    }
  };
}

export const logAccountEvent = createAccountDiagnosticLogger(settingsDir);
