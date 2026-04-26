import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type LoggerModule = typeof import('./logger.js');

describe('logger OTLP export', () => {
  let emitMock: ReturnType<typeof vi.fn>;
  let forceFlushMock: any;
  let shutdownMock: any;
  let exporterMock: any;
  let processorMock: any;
  let providerMock: any;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();

    emitMock = vi.fn();
    forceFlushMock = vi.fn().mockResolvedValue(undefined);
    shutdownMock = vi.fn().mockResolvedValue(undefined);
    exporterMock = vi.fn().mockImplementation((config: unknown) => ({
      config
    }));
    processorMock = vi.fn();
    providerMock = vi.fn();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../config.js');
    vi.doUnmock('@opentelemetry/exporter-logs-otlp-http');
    vi.doUnmock('@opentelemetry/sdk-logs');
  });

  it('keeps local logging and skips OTLP setup when disabled', async () => {
    const loggerModule = await loadLogger(false);

    loggerModule.logger.warn('local only', { visible: true }, 'TEST');

    expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN] [TEST]', 'local only', { visible: true });
    expect(exporterMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('exports structured logs to OTLP with redacted secret fields', async () => {
    const loggerModule = await loadLogger(true);

    loggerModule.logger.info(
      'sent to victoria',
      {
        apiToken: 'secret-token',
        nested: { password: 'secret-password' },
        visible: 'kept'
      },
      'TEST'
    );
    await loggerModule.logger.flush();

    expect(exporterMock).toHaveBeenCalledWith({
      url: 'http://victorialogs:9428/insert/opentelemetry/v1/logs',
      headers: {
        Authorization: 'Bearer secret-token',
        'VL-Stream-Fields': 'service.name,deployment.environment.name'
      },
      timeoutMillis: 2500
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(processorMock).toHaveBeenCalledWith(expect.anything(), {
      scheduledDelayMillis: 1000,
      exportTimeoutMillis: 2500,
      maxQueueSize: 32,
      maxExportBatchSize: 8
    });
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severityText: 'INFO',
        body: 'sent to victoria',
        attributes: expect.objectContaining({
          module: 'TEST',
          data: {
            apiToken: '[REDACTED]',
            nested: { password: '[REDACTED]' },
            visible: 'kept'
          }
        })
      })
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('[INFO] [TEST]', 'sent to victoria', {
      apiToken: '[REDACTED]',
      nested: { password: '[REDACTED]' },
      visible: 'kept'
    });
  });

  it('flushes and shuts down the OTLP logger provider', async () => {
    const loggerModule = await loadLogger(true);

    loggerModule.logger.info('queued', undefined, 'TEST');
    await loggerModule.logger.flush();
    await loggerModule.logger.shutdown();

    expect(forceFlushMock).toHaveBeenCalledOnce();
    expect(shutdownMock).toHaveBeenCalledOnce();
  });

  async function loadLogger(otlpEnabled: boolean): Promise<LoggerModule> {
    vi.doMock('../config.js', () => ({
      getDataDir: () => './data',
      getLogLevel: () => 'DEBUG',
      getNodeEnv: () => 'production',
      getVictoriaLogsOtlpBatchDelayMs: () => 1000,
      getVictoriaLogsOtlpEndpoint: () => 'http://victorialogs:9428/insert/opentelemetry/v1/logs',
      getVictoriaLogsOtlpHeaders: () => ({
        Authorization: 'Bearer secret-token',
        'VL-Stream-Fields': 'service.name,deployment.environment.name'
      }),
      getVictoriaLogsOtlpMaxExportBatchSize: () => 8,
      getVictoriaLogsOtlpMaxQueueSize: () => 32,
      getVictoriaLogsOtlpTimeoutMs: () => 2500,
      isDebugMode: () => false,
      isVictoriaLogsOtlpEnabled: () => otlpEnabled
    }));
    vi.doMock('@opentelemetry/exporter-logs-otlp-http', () => ({
      OTLPLogExporter: class {
        constructor(config: unknown) {
          exporterMock(config);
        }
      }
    }));
    vi.doMock('@opentelemetry/sdk-logs', () => ({
      BatchLogRecordProcessor: class {
        constructor(exporter: unknown, config: unknown) {
          processorMock(exporter, config);
        }
      },
      LoggerProvider: class {
        constructor(config: unknown) {
          providerMock(config);
        }

        getLogger() {
          return { emit: emitMock };
        }

        forceFlush() {
          return forceFlushMock();
        }

        shutdown() {
          return shutdownMock();
        }
      }
    }));

    return import('./logger.js');
  }
});
