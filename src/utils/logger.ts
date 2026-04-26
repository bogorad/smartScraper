import fs from 'fs';
import path from 'path';
import type { Logger as OtelLogger } from '@opentelemetry/api-logs';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import {
  getDataDir,
  getLogLevel,
  getNodeEnv,
  getVictoriaLogsOtlpBatchDelayMs,
  getVictoriaLogsOtlpEndpoint,
  getVictoriaLogsOtlpHeaders,
  getVictoriaLogsOtlpMaxExportBatchSize,
  getVictoriaLogsOtlpMaxQueueSize,
  getVictoriaLogsOtlpTimeoutMs,
  isDebugMode as configIsDebugMode,
  isVictoriaLogsOtlpEnabled
} from '../config.js';
import { VERSION } from '../constants.js';

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
let debugEnabled = false;
let otelLoggerProvider: LoggerProvider | null = null;
let otelLogger: OtelLogger | null = null;
let otlpInitialized = false;

function initLogFile() {
  if (logFileStream) return;

  try {
    const dataDir = getDataDir();
    const logDir = path.join(dataDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    const timestamp = new Date().toISOString().split('T')[0];
    const logFile = path.join(logDir, `scraper-${timestamp}.jsonl`);

    logFileStream = fs.createWriteStream(logFile, {
      flags: 'a'
    });

    logFileStream.on('error', (err) => {
      console.error('[LOGGER] File stream error:', err.message);
      logFileStream = null; // Disable file logging, continue with console
    });

    // Check if DEBUG env var is set (can be checked before config is initialized)
    debugEnabled = configIsDebugMode();
    // Also check LOG_LEVEL if config is available
    try {
      if (getLogLevel() === 'DEBUG') {
        debugEnabled = true;
      }
    } catch {
      // Config not initialized yet, use env var only
    }

    if (debugEnabled) {
      console.log(`[LOGGER] Debug mode enabled, logging to: ${logFile}`);
    }
  } catch (error) {
    console.error('[LOGGER] Failed to initialize log file:', error instanceof Error ? error.message : String(error));
  }
}

function shouldLog(level: LogLevel): boolean {
  let currentLevel: LogLevel;
  try {
    currentLevel = getLogLevel() as LogLevel;
  } catch {
    // Config not initialized yet - default to showing all logs
    currentLevel = 'DEBUG';
  }
  return LEVELS[level] >= LEVELS[currentLevel];
}

function initOtlpLogger() {
  if (otlpInitialized) return;
  otlpInitialized = true;

  try {
    if (!isVictoriaLogsOtlpEnabled()) {
      return;
    }

    const endpoint = getVictoriaLogsOtlpEndpoint();
    if (!endpoint) {
      console.warn('[LOGGER] VICTORIALOGS_OTLP_ENABLED is true but VICTORIALOGS_OTLP_ENDPOINT is empty.');
      return;
    }

    const timeoutMillis = getVictoriaLogsOtlpTimeoutMs();
    const exporter = new OTLPLogExporter({
      url: endpoint,
      headers: getVictoriaLogsOtlpHeaders(),
      timeoutMillis
    });

    const processor = new BatchLogRecordProcessor(exporter, {
      scheduledDelayMillis: getVictoriaLogsOtlpBatchDelayMs(),
      exportTimeoutMillis: timeoutMillis,
      maxQueueSize: getVictoriaLogsOtlpMaxQueueSize(),
      maxExportBatchSize: getVictoriaLogsOtlpMaxExportBatchSize()
    });

    otelLoggerProvider = new LoggerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: 'smart-scraper',
        [ATTR_SERVICE_VERSION]: VERSION,
        'deployment.environment.name': getNodeEnv()
      }),
      forceFlushTimeoutMillis: timeoutMillis,
      processors: [processor]
    });
    otelLogger = otelLoggerProvider.getLogger('smart-scraper', VERSION);
  } catch (error) {
    console.error(
      '[LOGGER] Failed to initialize OTLP logging:',
      error instanceof Error ? error.message : String(error)
    );
    otelLoggerProvider = null;
    otelLogger = null;
  }
}

function writeToFile(entry: LogEntry) {
  if (!logFileStream) {
    initLogFile();
  }

  if (logFileStream && debugEnabled) {
    try {
      logFileStream.write(JSON.stringify(entry) + '\n');
    } catch (error) {
      console.error('[LOGGER] Write error:', error instanceof Error ? error.message : String(error));
    }
  }
}

function severityNumber(level: LogLevel): SeverityNumber {
  switch (level) {
    case 'DEBUG':
      return SeverityNumber.DEBUG;
    case 'INFO':
      return SeverityNumber.INFO;
    case 'WARN':
      return SeverityNumber.WARN;
    case 'ERROR':
      return SeverityNumber.ERROR;
    case 'NONE':
      return SeverityNumber.UNSPECIFIED;
  }
}

function redactSecrets(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
      key,
      isSecretKey(key) ? '[REDACTED]' : redactSecrets(entryValue)
    ])
  );
}

function isSecretKey(key: string): boolean {
  return /authorization|api[_-]?key|token|secret|password|auth[_-]?header[_-]?value/i.test(key);
}

function otlpAttributes(entry: LogEntry): Record<string, any> {
  return {
    level: entry.level,
    ...(entry.module && { module: entry.module }),
    ...(entry.scrapeId && { scrapeId: entry.scrapeId }),
    ...(entry.url && { url: entry.url }),
    ...(entry.domain && { domain: entry.domain }),
    ...(entry.duration !== undefined && {
      duration: entry.duration
    }),
    ...(entry.error && { error: entry.error }),
    ...(entry.data !== undefined && { data: entry.data })
  };
}

function writeToOtlp(entry: LogEntry) {
  initOtlpLogger();
  if (!otelLogger) {
    return;
  }

  otelLogger.emit({
    timestamp: new Date(entry.timestamp),
    observedTimestamp: new Date(),
    severityNumber: severityNumber(entry.level),
    severityText: entry.level,
    body: entry.message,
    attributes: otlpAttributes(entry)
  });
}

function log(level: LogLevel, module: string | undefined, message: string, data?: any) {
  if (!shouldLog(level)) return;

  const timestamp = new Date().toISOString();
  const entry: LogEntry = {
    timestamp,
    level,
    message,
    ...(module && { module }),
    ...(data !== undefined && {
      data: redactSecrets(data)
    })
  };

  // Console output
  const prefix = module ? `[${level}] [${module}]` : `[${level}]`;
  if (data !== undefined) {
    if (level === 'ERROR') {
      console.error(prefix, message, entry.data);
    } else if (level === 'WARN') {
      console.warn(prefix, message, entry.data);
    } else {
      console.log(prefix, message, entry.data);
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
  writeToOtlp(entry);
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
      data: redactSecrets(config)
    };
    console.log(`[INFO] [SCRAPE] ${scrapeId} - Starting: ${url}`);
    writeToFile(entry);
    writeToOtlp(entry);
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
    writeToOtlp(entry);
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
    writeToOtlp(entry);
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
    writeToOtlp(entry);
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
    writeToOtlp(entry);
  },

  close: () => {
    if (logFileStream) {
      logFileStream.end();
      logFileStream = null;
    }
  },

  flush: async () => {
    if (otelLoggerProvider) {
      await otelLoggerProvider.forceFlush();
    }
  },

  shutdown: async () => {
    logger.close();
    if (otelLoggerProvider) {
      await otelLoggerProvider.shutdown();
      otelLoggerProvider = null;
      otelLogger = null;
    }
  }
};

// Don't initialize on import - wait for first log call
// This allows config to be initialized first

// Cleanup on process exit
process.on('exit', () => logger.close());
