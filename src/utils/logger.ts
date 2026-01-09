import fs from 'fs';
import path from 'path';
import { getLogLevel, getDataDir } from '../config.js';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'NONE';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module?: string;
  message: string;
  data?: any;
  scrapeId?: string;
  url?: string;
  domain?: string;
  duration?: number;
  error?: string;
}

const LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
};

let logFileStream: fs.WriteStream | null = null;
let isDebugMode = false;

function initLogFile() {
  if (logFileStream) return;
  
  try {
    const dataDir = getDataDir();
    const logDir = path.join(dataDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    
    const timestamp = new Date().toISOString().split('T')[0];
    const logFile = path.join(logDir, `scraper-${timestamp}.jsonl`);
    
    logFileStream = fs.createWriteStream(logFile, { flags: 'a' });
    
    // Check if DEBUG env var is set
    isDebugMode = process.env.DEBUG === 'true' || process.env.DEBUG === '1' || getLogLevel() === 'DEBUG';
    
    if (isDebugMode) {
      console.log(`[LOGGER] Debug mode enabled, logging to: ${logFile}`);
    }
  } catch (error) {
    // Silently fail if config not ready yet - will retry on first log
  }
}

function shouldLog(level: LogLevel): boolean {
  const currentLevel = getLogLevel() as LogLevel;
  return LEVELS[level] >= LEVELS[currentLevel];
}

function writeToFile(entry: LogEntry) {
  if (!logFileStream) {
    initLogFile();
  }
  
  if (logFileStream && isDebugMode) {
    try {
      logFileStream.write(JSON.stringify(entry) + '\n');
    } catch (error) {
      // Fail silently to not disrupt the application
    }
  }
}

function log(level: LogLevel, module: string | undefined, message: string, data?: any) {
  if (!shouldLog(level)) return;
  
  const timestamp = new Date().toISOString();
  const entry: LogEntry = {
    timestamp,
    level,
    message,
    ...(module && { module }),
    ...(data && { data })
  };
  
  // Console output
  const prefix = module ? `[${level}] [${module}]` : `[${level}]`;
  if (data !== undefined) {
    if (level === 'ERROR') {
      console.error(prefix, message, data);
    } else if (level === 'WARN') {
      console.warn(prefix, message, data);
    } else {
      console.log(prefix, message, data);
    }
  } else {
    if (level === 'ERROR') {
      console.error(prefix, message);
    } else if (level === 'WARN') {
      console.warn(prefix, message);
    } else {
      console.log(prefix, message);
    }
  }
  
  // File output (JSONL)
  writeToFile(entry);
}

export const logger = {
  debug: (message: string, data?: any, module?: string) => {
    log('DEBUG', module, message, data);
  },
  
  info: (message: string, data?: any, module?: string) => {
    log('INFO', module, message, data);
  },
  
  warn: (message: string, data?: any, module?: string) => {
    log('WARN', module, message, data);
  },
  
  error: (message: string, data?: any, module?: string) => {
    log('ERROR', module, message, data);
  },
  
  // Specialized logging methods for scraping
  scrapeStart: (scrapeId: string, url: string, domain: string, config?: any) => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      module: 'SCRAPE',
      message: 'Scrape started',
      scrapeId,
      url,
      domain,
      data: config
    };
    console.log(`[INFO] [SCRAPE] ${scrapeId} - Starting: ${url}`);
    writeToFile(entry);
  },
  
  scrapeEnd: (scrapeId: string, url: string, domain: string, success: boolean, duration: number, error?: string) => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: success ? 'INFO' : 'ERROR',
      module: 'SCRAPE',
      message: success ? 'Scrape completed' : 'Scrape failed',
      scrapeId,
      url,
      domain,
      duration,
      ...(error && { error })
    };
    console.log(`[${entry.level}] [SCRAPE] ${scrapeId} - ${entry.message} in ${duration}ms`);
    writeToFile(entry);
  },
  
  proxySession: (scrapeId: string, sessionUrl: string, sessionId: string, minutes: number) => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'DEBUG',
      module: 'PROXY',
      message: 'Generated proxy session',
      scrapeId,
      data: {
        sessionId,
        stickyMinutes: minutes,
        // Redact credentials from log
        sessionUrl: sessionUrl.replace(/:([^:@]+)@/, ':***@')
      }
    };
    console.log(`[DEBUG] [PROXY] ${scrapeId} - Session ${sessionId} (${minutes}min sticky)`);
    writeToFile(entry);
  },
  
  captchaDetected: (scrapeId: string, url: string, captchaType: string) => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      module: 'CAPTCHA',
      message: 'CAPTCHA detected',
      scrapeId,
      url,
      data: { captchaType }
    };
    console.warn(`[WARN] [CAPTCHA] ${scrapeId} - Detected: ${captchaType}`);
    writeToFile(entry);
  },
  
  captchaSolved: (scrapeId: string, url: string, success: boolean, duration: number, reason?: string) => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: success ? 'INFO' : 'ERROR',
      module: 'CAPTCHA',
      message: success ? 'CAPTCHA solved' : 'CAPTCHA solve failed',
      scrapeId,
      url,
      duration,
      ...(reason && { error: reason })
    };
    console.log(`[${entry.level}] [CAPTCHA] ${scrapeId} - ${entry.message} in ${duration}ms`);
    writeToFile(entry);
  },
  
  close: () => {
    if (logFileStream) {
      logFileStream.end();
      logFileStream = null;
    }
  }
};

// Don't initialize on import - wait for first log call
// This allows config to be initialized first

// Cleanup on process exit
process.on('exit', () => logger.close());
process.on('SIGINT', () => {
  logger.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  logger.close();
  process.exit(0);
});
