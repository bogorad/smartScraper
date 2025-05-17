// src/utils/logger.js
const LOG_LEVELS = {
  DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4,
};
const currentLogLevelName = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
const currentLogLevel = LOG_LEVELS[currentLogLevelName] !== undefined ? LOG_LEVELS[currentLogLevelName] : LOG_LEVELS.INFO;
function getTimestamp() { return new Date().toISOString(); }
const logger = {
  level: currentLogLevelName,
  log: (level, ...args) => { /* ... */ }, // Simplified for brevity
  debug: (...args) => { if (currentLogLevel <= LOG_LEVELS.DEBUG) console.debug(`[${getTimestamp()}] [DEBUG]`, ...args); },
  info: (...args) => { if (currentLogLevel <= LOG_LEVELS.INFO) console.info(`[${getTimestamp()}] [INFO]`, ...args); },
  warn: (...args) => { if (currentLogLevel <= LOG_LEVELS.WARN) console.warn(`[${getTimestamp()}] [WARN]`, ...args); },
  error: (...args) => { if (currentLogLevel <= LOG_LEVELS.ERROR) console.error(`[${getTimestamp()}] [ERROR]`, ...args); },
  setLevel: (levelName) => { /* ... */ },
};
export { logger };
