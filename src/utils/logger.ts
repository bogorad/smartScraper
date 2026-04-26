import fs from "fs";
import path from "path";
import {
  diag,
  DiagLogLevel,
  type DiagLogger,
} from "@opentelemetry/api";
import type { Logger as OtelLogger } from "@opentelemetry/api-logs";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPExporterBase } from "@opentelemetry/otlp-exporter-base";
import {
  convertLegacyHttpOptions,
  createOtlpHttpExportDelegate,
} from "@opentelemetry/otlp-exporter-base/node-http";
import { ProtobufLogsSerializer } from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
  type ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

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
  isVictoriaLogsOtlpEnabled,
} from "../config.js";
import { VERSION } from "../constants.js";

type LogLevel =
  | "DEBUG"
  | "INFO"
  | "WARN"
  | "ERROR"
  | "NONE";

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
  NONE: 4,
};

let logFileStream: fs.WriteStream | null = null;
let debugEnabled = false;
let otelLoggerProvider: LoggerProvider | null = null;
let otelLogger: OtelLogger | null = null;
let otlpInitialized = false;
let otlpDiagnosticsInitialized = false;

const LOGGER_EXIT_CLEANUP_KEY = Symbol.for(
  "smartScraper.logger.exitCleanupRegistered",
);

interface OtlpHttpExporterConfig {
  url?: string;
  headers?: Record<string, string>;
  timeoutMillis?: number;
}

class ProtobufOTLPLogExporter
  extends OTLPExporterBase<ReadableLogRecord[]>
  implements LogRecordExporter
{
  constructor(config: OtlpHttpExporterConfig = {}) {
    super(
      createOtlpHttpExportDelegate(
        convertLegacyHttpOptions(
          config,
          "LOGS",
          "v1/logs",
          {
            "Content-Type": "application/x-protobuf",
          },
        ),
        ProtobufLogsSerializer,
      ),
    );
  }
}

function writeConsole(
  level: LogLevel,
  prefix: string,
  message: string,
  data?: unknown,
) {
  const args =
    data === undefined
      ? [prefix, message]
      : [prefix, message, data];

  if (level === "ERROR") {
    console.error(...args);
  } else if (level === "WARN") {
    console.warn(...args);
  } else {
    console.log(...args);
  }
}

function writeInternal(
  level: LogLevel,
  message: string,
  data?: unknown,
) {
  writeConsole(level, "[LOGGER]", message, data);
}

function currentUtcTimestamp(): string {
  return new Date().toISOString();
}

function formatDiagnostic(
  message: string,
  args: unknown[],
): string {
  if (args.length === 0) {
    return message;
  }

  const formattedArgs = args
    .map((arg) =>
      arg instanceof Error ? arg.message : String(arg),
    )
    .join(" ");
  return `${message} ${formattedArgs}`;
}

function initOtlpDiagnostics() {
  if (otlpDiagnosticsInitialized) return;
  otlpDiagnosticsInitialized = true;

  const diagnosticLogger: DiagLogger = {
    error: (message, ...args) =>
      writeInternal(
        "ERROR",
        "OTLP export error:",
        formatDiagnostic(message, args),
      ),
    warn: (message, ...args) =>
      writeInternal(
        "WARN",
        "OTLP export warning:",
        formatDiagnostic(message, args),
      ),
    info: (message, ...args) =>
      writeInternal(
        "INFO",
        "OTLP export info:",
        formatDiagnostic(message, args),
      ),
    debug: (message, ...args) =>
      writeInternal(
        "DEBUG",
        "OTLP export debug:",
        formatDiagnostic(message, args),
      ),
    verbose: (message, ...args) =>
      writeInternal(
        "DEBUG",
        "OTLP export verbose:",
        formatDiagnostic(message, args),
      ),
  };

  diag.setLogger(diagnosticLogger, {
    logLevel: DiagLogLevel.WARN,
    suppressOverrideMessage: true,
  });
}

function initLogFile() {
  if (logFileStream) return;

  try {
    const dataDir = getDataDir();
    const logDir = path.join(dataDir, "logs");
    fs.mkdirSync(logDir, { recursive: true });

    const timestamp = new Date()
      .toISOString()
      .split("T")[0];
    const logFile = path.join(
      logDir,
      `scraper-${timestamp}.jsonl`,
    );

    logFileStream = fs.createWriteStream(logFile, {
      flags: "a",
    });

    logFileStream.on("error", (err) => {
      writeInternal(
        "ERROR",
        "File stream error:",
        err.message,
      );
      logFileStream = null; // Disable file logging, continue with console
    });

    // Check if DEBUG env var is set (can be checked before config is initialized)
    debugEnabled = configIsDebugMode();
    // Also check LOG_LEVEL if config is available
    try {
      if (getLogLevel() === "DEBUG") {
        debugEnabled = true;
      }
    } catch {
      // Config not initialized yet, use env var only
    }

    if (debugEnabled) {
      writeInternal(
        "INFO",
        `Debug mode enabled, logging to: ${logFile}`,
      );
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);
    if (
      message !==
      "Config not initialized. Call initConfig() first."
    ) {
      writeInternal(
        "ERROR",
        "Failed to initialize log file:",
        message,
      );
    }
  }
}

function shouldLog(level: LogLevel): boolean {
  let currentLevel: LogLevel;
  try {
    currentLevel = getLogLevel() as LogLevel;
  } catch {
    // Config not initialized yet - default to showing all logs
    currentLevel = "DEBUG";
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

    initOtlpDiagnostics();

    const endpoint = getVictoriaLogsOtlpEndpoint();
    if (!endpoint) {
      writeInternal(
        "ERROR",
        "VICTORIALOGS_OTLP_ENABLED is true but VICTORIALOGS_OTLP_ENDPOINT is empty.",
        {
          timestampUtc: currentUtcTimestamp(),
        },
      );
      return;
    }

    const timeoutMillis = getVictoriaLogsOtlpTimeoutMs();
    const headers = getVictoriaLogsOtlpHeaders();
    writeInternal("INFO", "OTLP logging enabled.", {
      timestampUtc: currentUtcTimestamp(),
      endpoint,
      headers: redactSecrets(headers),
      timeoutMillis,
    });

    const exporter = new ProtobufOTLPLogExporter({
      url: endpoint,
      headers,
      timeoutMillis,
    });

    const processor = new BatchLogRecordProcessor(
      exporter,
      {
        scheduledDelayMillis:
          getVictoriaLogsOtlpBatchDelayMs(),
        exportTimeoutMillis: timeoutMillis,
        maxQueueSize: getVictoriaLogsOtlpMaxQueueSize(),
        maxExportBatchSize:
          getVictoriaLogsOtlpMaxExportBatchSize(),
      },
    );

    otelLoggerProvider = new LoggerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: "smart-scraper",
        [ATTR_SERVICE_VERSION]: VERSION,
        "deployment.environment.name": getNodeEnv(),
      }),
      forceFlushTimeoutMillis: timeoutMillis,
      processors: [processor],
    });
    otelLogger = otelLoggerProvider.getLogger(
      "smart-scraper",
      VERSION,
    );
  } catch (error) {
    writeInternal(
      "ERROR",
      "Failed to initialize OTLP logging:",
      {
        timestampUtc: currentUtcTimestamp(),
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
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
      logFileStream.write(JSON.stringify(entry) + "\n");
    } catch (error) {
      writeInternal(
        "ERROR",
        "Write error:",
        error instanceof Error
          ? error.message
          : String(error),
      );
    }
  }
}

function severityNumber(level: LogLevel): SeverityNumber {
  switch (level) {
    case "DEBUG":
      return SeverityNumber.DEBUG;
    case "INFO":
      return SeverityNumber.INFO;
    case "WARN":
      return SeverityNumber.WARN;
    case "ERROR":
      return SeverityNumber.ERROR;
    case "NONE":
      return SeverityNumber.UNSPECIFIED;
  }
}

function redactSecrets(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(
      ([key, entryValue]) => [
        key,
        isSecretKey(key)
          ? "[REDACTED]"
          : redactSecrets(entryValue),
      ],
    ),
  );
}

function isSecretKey(key: string): boolean {
  return /authorization|api[_-]?key|client[_-]?key|token|secret|password|cookie|set[_-]?cookie|auth[_-]?header[_-]?value/i.test(
    key,
  );
}

function otlpAttributes(
  entry: LogEntry,
): Record<string, any> {
  return {
    level: entry.level,
    ...(entry.module && { module: entry.module }),
    ...(entry.scrapeId && { scrapeId: entry.scrapeId }),
    ...(entry.url && { url: entry.url }),
    ...(entry.domain && { domain: entry.domain }),
    ...(entry.duration !== undefined && {
      duration: entry.duration,
    }),
    ...(entry.error && { error: entry.error }),
    ...(entry.data !== undefined && { data: entry.data }),
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
    attributes: otlpAttributes(entry),
  });
}

function log(
  level: LogLevel,
  module: string | undefined,
  message: string,
  data?: any,
) {
  if (!shouldLog(level)) return;

  const timestamp = new Date().toISOString();
  const entry: LogEntry = {
    timestamp,
    level,
    message,
    ...(module && { module }),
    ...(data !== undefined && {
      data: redactSecrets(data),
    }),
  };

  const prefix = module
    ? `[${level}] [${module}]`
    : `[${level}]`;
  writeConsole(level, prefix, message, entry.data);
  writeToFile(entry);
  writeToOtlp(entry);
}

export const logger = {
  debug: (message: string, data?: any, module?: string) => {
    log("DEBUG", module, message, data);
  },

  info: (message: string, data?: any, module?: string) => {
    log("INFO", module, message, data);
  },

  warn: (message: string, data?: any, module?: string) => {
    log("WARN", module, message, data);
  },

  error: (message: string, data?: any, module?: string) => {
    log("ERROR", module, message, data);
  },

  // Specialized logging methods for scraping
  scrapeStart: (
    scrapeId: string,
    url: string,
    domain: string,
    config?: any,
  ) => {
    log(
      "INFO",
      "SCRAPE",
      `${scrapeId} - Starting: ${url}`,
      {
        scrapeId,
        url,
        domain,
        config,
      },
    );
  },

  scrapeEnd: (
    scrapeId: string,
    url: string,
    domain: string,
    success: boolean,
    duration: number,
    error?: string,
  ) => {
    log(
      success ? "INFO" : "ERROR",
      "SCRAPE",
      `${scrapeId} - ${success ? "Scrape completed" : "Scrape failed"} in ${duration}ms`,
      {
        scrapeId,
        url,
        domain,
        duration,
        ...(error && { error }),
      },
    );
  },

  proxySession: (
    scrapeId: string,
    sessionUrl: string,
    sessionId: string,
    minutes: number,
  ) => {
    log(
      "DEBUG",
      "PROXY",
      `${scrapeId} - Session ${sessionId} (${minutes}min sticky)`,
      {
        scrapeId,
        sessionId,
        stickyMinutes: minutes,
        sessionUrl: sessionUrl.replace(
          /:([^:@]+)@/,
          ":***@",
        ),
      },
    );
  },

  captchaDetected: (
    scrapeId: string,
    url: string,
    captchaType: string,
  ) => {
    log(
      "WARN",
      "CAPTCHA",
      `${scrapeId} - Detected: ${captchaType}`,
      {
        scrapeId,
        url,
        captchaType,
      },
    );
  },

  captchaSolved: (
    scrapeId: string,
    url: string,
    success: boolean,
    duration: number,
    reason?: string,
  ) => {
    log(
      success ? "INFO" : "ERROR",
      "CAPTCHA",
      `${scrapeId} - ${success ? "CAPTCHA solved" : "CAPTCHA solve failed"} in ${duration}ms`,
      {
        scrapeId,
        url,
        duration,
        ...(reason && { error: reason }),
      },
    );
  },

  close: () => {
    if (logFileStream) {
      logFileStream.end();
      logFileStream = null;
    }
  },

  flush: async () => {
    if (otelLoggerProvider) {
      try {
        await otelLoggerProvider.forceFlush();
      } catch (error) {
        writeInternal(
          "ERROR",
          "Failed to flush OTLP logs:",
          {
            timestampUtc: currentUtcTimestamp(),
            error:
              error instanceof Error
                ? error.message
                : String(error),
          },
        );
      }
    }
  },

  shutdown: async () => {
    logger.close();
    if (otelLoggerProvider) {
      try {
        await otelLoggerProvider.shutdown();
      } catch (error) {
        writeInternal(
          "ERROR",
          "Failed to shutdown OTLP logger:",
          {
            timestampUtc: currentUtcTimestamp(),
            error:
              error instanceof Error
                ? error.message
                : String(error),
          },
        );
      } finally {
        otelLoggerProvider = null;
        otelLogger = null;
      }
    }
  },
};

// Don't initialize on import - wait for first log call
// This allows config to be initialized first

function registerExitCleanup() {
  const globalState = globalThis as typeof globalThis &
    Record<symbol, boolean | undefined>;
  if (globalState[LOGGER_EXIT_CLEANUP_KEY]) {
    return;
  }

  globalState[LOGGER_EXIT_CLEANUP_KEY] = true;
  process.on("exit", () => logger.close());
}

// Cleanup on process exit
registerExitCleanup();
