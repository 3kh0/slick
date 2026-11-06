// The Chime SDK's logger, pointed at the call log (callLog.ts) as well as the
// console: info and up go to the log you can copy from the call window, only
// warnings and up to the console so DevTools stays quiet. Never sends anything.

import type ChimeLogger from 'amazon-chime-sdk-js/build/logger/Logger.js';
import type ChimeLogLevel from 'amazon-chime-sdk-js/build/logger/LogLevel.js';
import type { LogLevel } from '../callLog.ts';

// Chime's LogLevel enum values (logger/LogLevel.js); kept local so this file loads without the SDK.
const CHIME_LEVEL = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, OFF: 4 } as const;
const CONSOLE_PREFIX = '[slick] [Better Huddles] [chime]';

export type RecordLine = (level: LogLevel, message: string) => void;

export function createRecordingLogger(
  record: RecordLine,
  { consoleLevel = CHIME_LEVEL.WARN as number, output = console } = {},
): ChimeLogger {
  let level = consoleLevel;
  const write = (lineLevel: LogLevel, chimeLevel: number, message: string) => {
    record(lineLevel, `[chime] ${message}`);
    if (chimeLevel < level) return;
    if (lineLevel === 'error') output.error(CONSOLE_PREFIX, message);
    else if (lineLevel === 'warn') output.warn(CONSOLE_PREFIX, message);
    else output.info(CONSOLE_PREFIX, message);
  };
  return {
    // Debug output is SDP dumps and per-packet chatter: built lazily and dropped unless asked for in the console.
    debug(debugFunction) {
      if (level > CHIME_LEVEL.DEBUG) return;
      write('debug', CHIME_LEVEL.DEBUG, typeof debugFunction === 'function' ? debugFunction() : debugFunction);
    },
    info: (message) => write('info', CHIME_LEVEL.INFO, message),
    warn: (message) => write('warn', CHIME_LEVEL.WARN, message),
    error: (message) => write('error', CHIME_LEVEL.ERROR, message),
    setLogLevel(newLevel) {
      level = newLevel as number;
    },
    getLogLevel: () => level as ChimeLogLevel,
  };
}
