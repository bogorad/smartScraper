import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diag } from '@opentelemetry/api';

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
    diag.disable();
    vi.doUnmock('../config.js');
    vi.doUnmock('@opentelemetry/otlp-exporter-base');
    vi.doUnmock('@opentelemetry/otlp-exporter-base/node-http');
    vi.doUnmock('@opentelemetry/otlp-transformer');
    vi.doUnmock('@opentelemetry/sdk-logs');
  });

  it('keeps local logging and skips OTLP setup when disabled', async () => {
    const loggerModule = await loadLogger(false);

    loggerModule.logger.warn('local only', { visible: true }, 'TEST');

    expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN] [TEST]', 'local only', { visible: true });
    expect(exporterMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('filters logs below the configured level', async () => {
    const loggerModule = await loadLogger(false, 'WARN');

    loggerModule.logger.info('too noisy', undefined, 'TEST');
    loggerModule.logger.warn('visible warning', undefined, 'TEST');

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN] [TEST]', 'visible warning');
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
      options: {
        config: {
          url: 'http://victorialogs:9428/insert/opentelemetry/v1/logs',
          headers: {
            Authorization: 'Bearer secret-token',
            'VL-Stream-Fields': 'service.name,deployment.environment.name'
          },
          timeoutMillis: 2500
        },
        requiredHeaders: {
          'Content-Type': 'application/x-protobuf'
        },
        signalIdentifier: 'LOGS',
        signalResourcePath: 'v1/logs'
      },
      serializer: 'protobuf-logs-serializer'
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

  it('routes OpenTelemetry export failures to the local logger', async () => {
    const loggerModule = await loadLogger(true);

    loggerModule.logger.info('queued', undefined, 'TEST');
    diag.error('export response failure (status: 400)');

    expect(consoleErrorSpy).toHaveBeenCalledWith('[LOGGER]', 'OTLP export error:', 'export response failure (status: 400)');
  });

  async function loadLogger(otlpEnabled: boolean, logLevel = 'DEBUG'): Promise<LoggerModule> {
    vi.doMock('../config.js', () => ({
      getDataDir: () => './data',
      getLogLevel: () => logLevel,
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
    vi.doMock('@opentelemetry/otlp-exporter-base', () => ({
      OTLPExporterBase: class {
        constructor(delegate: unknown) {
          exporterMock(delegate);
        }
      }
    }));
    vi.doMock('@opentelemetry/otlp-exporter-base/node-http', () => ({
      convertLegacyHttpOptions: (
        config: unknown,
        signalIdentifier: string,
        signalResourcePath: string,
        requiredHeaders: Record<string, string>
      ) => ({
        config,
        requiredHeaders,
        signalIdentifier,
        signalResourcePath
      }),
      createOtlpHttpExportDelegate: (options: unknown, serializer: unknown) => {
        return { options, serializer };
      }
    }));
    vi.doMock('@opentelemetry/otlp-transformer', () => ({
      ProtobufLogsSerializer: 'protobuf-logs-serializer'
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
