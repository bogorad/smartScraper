// src/utils/logger.js

// Basic console logger with levels and timestamps.
// For a production system, consider using a more robust logging library like Winston or Pino.

const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4, // To disable logging
};

// Determine log level from environment variable or default to INFO
const currentLogLevelName = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
const currentLogLevel = LOG_LEVELS[currentLogLevelName] !== undefined ? LOG_LEVELS[currentLogLevelName] : LOG_LEVELS.INFO;

function getTimestamp() {
    return new Date().toISOString();
}

const logger = {
    debug: (...args) => {
        if (currentLogLevel <= LOG_LEVELS.DEBUG) {
            console.debug(`[${getTimestamp()}] [DEBUG]`, ...args);
        }
    },
    info: (...args) => {
        if (currentLogLevel <= LOG_LEVELS.INFO) {
            console.info(`[${getTimestamp()}] [INFO]`, ...args);
        }
    },
    warn: (...args) => {
        if (currentLogLevel <= LOG_LEVELS.WARN) {
            console.warn(`[${getTimestamp()}] [WARN]`, ...args);
        }
    },
    error: (...args) => {
        if (currentLogLevel <= LOG_LEVELS.ERROR) {
            console.error(`[${getTimestamp()}] [ERROR]`, ...args);
        }
    },
    setLevel: (levelName) => {
        const newLevel = LOG_LEVELS[levelName.toUpperCase()];
        if (newLevel !== undefined) {
            // This basic logger doesn't dynamically change currentLogLevel after module load.
            // A more advanced logger would handle this. For now, it's set at startup.
            console.warn(`[${getTimestamp()}] [WARN] Basic logger level is set at startup. To change, restart with LOG_LEVEL=${levelName}. Current effective level: ${currentLogLevelName}`);
        } else {
            console.warn(`[${getTimestamp()}] [WARN] Invalid log level: ${levelName}`);
        }
    }
};

// Example of how to use:
// logger.info('This is an info message.');
// logger.debug('This is a debug message, only shown if LOG_LEVEL is DEBUG.');

export default logger;
