import { getLogLevel } from '../config.js';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'NONE';

const LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
};

function shouldLog(level: LogLevel): boolean {
  const currentLevel = getLogLevel() as LogLevel;
  return LEVELS[level] >= LEVELS[currentLevel];
}

export const logger = {
  debug: (message: string, ...args: any[]) => {
    if (shouldLog('DEBUG')) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  },
  
  info: (message: string, ...args: any[]) => {
    if (shouldLog('INFO')) {
      console.log(`[INFO] ${message}`, ...args);
    }
  },
  
  warn: (message: string, ...args: any[]) => {
    if (shouldLog('WARN')) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  },
  
  error: (message: string, ...args: any[]) => {
    if (shouldLog('ERROR')) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }
};
