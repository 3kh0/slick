import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCallLog, describeError } from '../../callLog.ts';

describe('createCallLog', () => {
  it('formats entries as time, level, message under an optional header', () => {
    const log = createCallLog({ now: () => Date.UTC(2026, 10, 5, 12, 1, 2, 345) });
    log.add('info', 'joining');
    log.add('error', 'join failed');
    assert.equal(log.format(), '12:01:02.345 INFO  joining\n12:01:02.345 ERROR join failed');
    assert.equal(log.format('header').split('\n')[0], 'header');
  });

  it('keeps only the newest entries past the limit', () => {
    const log = createCallLog({ limit: 2 });
    for (const message of ['one', 'two', 'three']) log.add('info', message);
    assert.deepEqual(
      log.entries.get().map((entry) => entry.message),
      ['two', 'three'],
    );
  });

  it('scrubs Slack tokens and redacted secrets, including lines logged before redact()', () => {
    const log = createCallLog();
    log.add('info', 'token xoxc-123-abc leaked');
    log.add('info', 'join token SECRETJOINTOKEN in a url');
    log.redact('SECRETJOINTOKEN');
    log.add('info', 'again SECRETJOINTOKEN');
    const text = log.format();
    assert.ok(!text.includes('xoxc-123-abc'));
    assert.ok(!text.includes('SECRETJOINTOKEN'));
    assert.equal(text.split('[redacted]').length - 1, 3);
  });

  it('ignores secrets too short to redact safely', () => {
    const log = createCallLog();
    log.redact('a');
    log.add('info', 'a cat');
    assert.ok(log.format().endsWith('a cat'));
  });

  it('truncates huge messages', () => {
    const log = createCallLog();
    log.add('debug', 'x'.repeat(5_000));
    assert.ok(log.entries.get()[0].message.length < 2_100);
    assert.ok(log.entries.get()[0].message.endsWith('(truncated)'));
  });

  it('clear() empties the log', () => {
    const log = createCallLog();
    log.add('info', 'one');
    log.clear();
    assert.equal(log.entries.get().length, 0);
  });
});

describe('describeError', () => {
  it('includes the error name, message and stack frames', () => {
    const error = new TypeError('qv.default is not a constructor');
    const text = describeError(error);
    assert.ok(text.startsWith('TypeError: qv.default is not a constructor\n'));
    assert.ok(text.includes('at '));
  });

  it('stringifies non-errors', () => {
    assert.equal(describeError('nope'), 'nope');
  });
});
