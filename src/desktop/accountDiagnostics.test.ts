import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ACCOUNT_LOG_MAX_BYTES, createAccountDiagnosticLogger, formatAccountEvent } from './accountDiagnostics.ts';

function temporary(t: { after: (cleanup: () => void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-account-diagnostics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('formatter retains only typed allowlisted diagnostics, never credentials or errors', () => {
  const line = formatAccountEvent('ssb.transition.failed', {
    senderId: 12,
    clientCount: 2,
    busy: false,
    action: 'reset',
    stage: 'failed',
    source: 'redirect',
    reason: 'failed',
    url: 'https://slack.com/ssb/redirect?token=secret-query',
    error: new Error('secret-error'),
    cookie: 'secret-cookie',
    token: 'secret-token',
    user: 'secret-user',
    team: { token: 'secret-team' },
    webContentsId: 'secret-id',
    accountCount: NaN,
    cookieCount: -1,
    handoffCount: Infinity,
    success: 'secret-success',
  });
  assert.ok(line);
  assert.deepEqual(JSON.parse(line).details, {
    senderId: 12,
    clientCount: 2,
    busy: false,
    action: 'reset',
    source: 'redirect',
    stage: 'failed',
    reason: 'failed',
  });
  assert.doesNotMatch(line, /secret|https|token|cookie|user|team|error/);
  assert.equal(JSON.parse(line).event, 'ssb.transition.failed');
  assert.ok(Number.isFinite(Date.parse(JSON.parse(line).timestamp)));
  assert.deepEqual(
    JSON.parse(
      formatAccountEvent('capture', {
        action: 'https://slack.com/?token=secret',
        reason: 'secret-error',
        senderId: Number.MAX_SAFE_INTEGER + 1,
      })!,
    ).details,
    {},
  );
});

test('invalid event identifiers and non-plain details are rejected', () => {
  for (const event of [
    '',
    'Account capture failed',
    'a\n',
    'a?token=secret',
    'https://slack.com',
    'a'.repeat(82),
    new Error('secret'),
  ]) {
    assert.equal(formatAccountEvent(event, {}), null);
  }
  for (const details of [null, undefined, [], 'secret', new Error('secret'), new Date()]) {
    assert.equal(formatAccountEvent('capture', details), null);
  }
  assert.ok(formatAccountEvent('a'.repeat(81), Object.create(null)));
});

test('accessors, inherited values and hostile objects cannot leak or throw', () => {
  const details = Object.create(null);
  Object.defineProperty(details, 'senderId', {
    get() {
      throw new Error('must not read');
    },
  });
  Object.defineProperty(details, 'toJSON', {
    value() {
      throw new Error('must not serialize');
    },
  });
  assert.deepEqual(JSON.parse(formatAccountEvent('capture', details)!).details, {});
  assert.equal(
    formatAccountEvent(
      'capture',
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('secret');
          },
        },
      ),
    ),
    null,
  );
});

test('persists sanitized JSON lines across logger instances', (t) => {
  const dir = temporary(t);
  const log = createAccountDiagnosticLogger(() => path.join(dir, 'settings'));
  log('capture.start', { accountCount: 2, token: 'secret' });
  createAccountDiagnosticLogger(() => path.join(dir, 'settings'))('capture.complete', { success: true });
  const lines = fs
    .readFileSync(path.join(dir, 'settings', 'account-switcher.log'), 'utf8')
    .trim()
    .split('\n');
  assert.deepEqual(
    lines.map((line) => JSON.parse(line).event),
    ['capture.start', 'capture.complete'],
  );
  assert.doesNotMatch(lines.join('\n'), /secret|token/);
  log('https://slack.com/?secret', {});
  assert.equal(
    fs
      .readFileSync(path.join(dir, 'settings', 'account-switcher.log'), 'utf8')
      .trim()
      .split('\n').length,
    2,
  );
});

test('rotation bounds active log and replaces exactly one backup', (t) => {
  const dir = temporary(t);
  const file = path.join(dir, 'account-switcher.log');
  const log = createAccountDiagnosticLogger(() => dir);
  fs.writeFileSync(file, 'x'.repeat(ACCOUNT_LOG_MAX_BYTES));
  fs.writeFileSync(`${file}.1`, 'old backup');
  log('capture.complete', { success: true });
  assert.equal(fs.statSync(`${file}.1`).size, ACCOUNT_LOG_MAX_BYTES);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).event, 'capture.complete');
  fs.writeFileSync(file, 'y'.repeat(ACCOUNT_LOG_MAX_BYTES + 100));
  log('capture.start', {});
  assert.equal(fs.statSync(`${file}.1`).size, ACCOUNT_LOG_MAX_BYTES);
  assert.ok(fs.statSync(file).size <= ACCOUNT_LOG_MAX_BYTES);
  assert.deepEqual(fs.readdirSync(dir).toSorted(), ['account-switcher.log', 'account-switcher.log.1']);
});

test('directory, append and rotation IO failures are swallowed', (t) => {
  const dir = temporary(t);
  const blocked = path.join(dir, 'blocked');
  fs.writeFileSync(blocked, 'not a directory');
  assert.doesNotThrow(() => createAccountDiagnosticLogger(() => blocked)('capture', {}));
  assert.doesNotThrow(() =>
    createAccountDiagnosticLogger(() => {
      throw new Error('secret');
    })('capture', {}),
  );
  const file = path.join(dir, 'account-switcher.log');
  fs.mkdirSync(file);
  assert.doesNotThrow(() => createAccountDiagnosticLogger(() => dir)('capture', {}));
  fs.rmdirSync(file);
  fs.writeFileSync(file, 'x'.repeat(ACCOUNT_LOG_MAX_BYTES));
  fs.mkdirSync(`${file}.1`);
  assert.doesNotThrow(() => createAccountDiagnosticLogger(() => dir)('capture', {}));
  assert.equal(fs.statSync(file).size, ACCOUNT_LOG_MAX_BYTES);
});
