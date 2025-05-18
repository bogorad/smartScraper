// src/utils/logger.ts

export enum LogLevel { // Export enum
  NONE = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
}

const LOG_LEVELS: Record<string, LogLevel> = {
  NONE: LogLevel.NONE,
  ERROR: LogLevel.ERROR,
  WARN: LogLevel.WARN,
  INFO: LogLevel.INFO,
  DEBUG: LogLevel.DEBUG,
};

let currentLogLevelName = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
let currentLogLevel: LogLevel = LOG_LEVELS[currentLogLevelName] || LogLevel.INFO; // Explicitly type currentLogLevel

function getTimestamp(): string { return new Date().toISOString(); }

const logger = {
  log: (level: LogLevel, ...args: any[]): void => {
    if (level <= currentLogLevel) {
      const levelName = Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === level) || 'LOG';
      console.log(`[${getTimestamp()}] [${levelName}]`, ...args);
    }
  },
  debug: (...args: any[]): void => { if (currentLogLevel >= LogLevel.DEBUG) console.debug(`[${getTimestamp()}] [DEBUG]`, ...args); },
  info: (...args: any[]): void => { if (currentLogLevel >= LogLevel.INFO) console.info(`[${getTimestamp()}] [INFO]`, ...args); },
  warn: (...args: any[]): void => { if (currentLogLevel >= LogLevel.WARN) console.warn(`[${getTimestamp()}] [WARN]`, ...args); },
  error: (...args: any[]): void => { if (currentLogLevel >= LogLevel.ERROR) console.error(`[${getTimestamp()}] [ERROR]`, ...args); },
  setLevel: (levelName: string): void => {
    const upperLevelName = levelName.toUpperCase();
    if (LOG_LEVELS[upperLevelName] !== undefined) {
      currentLogLevelName = upperLevelName;
      currentLogLevel = LOG_LEVELS[upperLevelName] as LogLevel; // Cast to LogLevel
      logger.info(`Log level set to ${currentLogLevelName}`);
    } else {
      logger.warn(`Invalid log level: ${levelName}. Keeping current level: ${currentLogLevelName}`);
    }
  },
  getCurrentLogLevel: (): LogLevel => currentLogLevel,
  isDebugging: (): boolean => currentLogLevel === LogLevel.DEBUG,
};

export { logger }; // LogLevel is already exported via enum
