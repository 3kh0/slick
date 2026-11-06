import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LogLevel } from '../../callLog.ts';
import { createRecordingLogger } from '../../media/recordingLogger.ts';

function fakeConsole() {
  const printed: string[] = [];
  const print = (kind: string) => (_prefix: string, message: string) => printed.push(`${kind}:${message}`);
  return { printed, output: { info: print('info'), warn: print('warn'), error: print('error') } as unknown as Console };
}

describe('createRecordingLogger', () => {
  it('records info and up, prints only warnings and errors', () => {
    const recorded: [LogLevel, string][] = [];
    const { printed, output } = fakeConsole();
    const logger = createRecordingLogger((level, message) => recorded.push([level, message]), { output });
    logger.info('connecting');
    logger.warn('slow');
    logger.error('failed');
    assert.deepEqual(recorded, [
      ['info', '[chime] connecting'],
      ['warn', '[chime] slow'],
      ['error', '[chime] failed'],
    ]);
    assert.deepEqual(printed, ['warn:slow', 'error:failed']);
  });

  it("doesn't build debug messages unless the level asks for them", () => {
    const recorded: string[] = [];
    let built = 0;
    const logger = createRecordingLogger((_level, message) => recorded.push(message), { output: fakeConsole().output });
    logger.debug(() => `sdp ${++built}`);
    assert.equal(built, 0);
    logger.setLogLevel(0 as never);
    logger.debug(() => `sdp ${++built}`);
    assert.equal(built, 1);
    assert.deepEqual(recorded, ['[chime] sdp 1']);
    assert.equal(logger.getLogLevel(), 0);
  });
});
