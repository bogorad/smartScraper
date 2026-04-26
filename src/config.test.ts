import { beforeEach, describe, expect, it, vi } from 'vitest';

const envKeys = [
  'NODE_ENV',
  'VICTORIALOGS_OTLP_ENABLED',
  'VICTORIALOGS_OTLP_ENDPOINT',
  'VICTORIALOGS_OTLP_HEADERS',
  'VICTORIALOGS_OTLP_AUTH_HEADER_NAME',
  'VICTORIALOGS_OTLP_AUTH_HEADER_VALUE',
  'VICTORIALOGS_OTLP_STREAM_FIELDS',
  'VICTORIALOGS_OTLP_TIMEOUT_MS',
  'VICTORIALOGS_OTLP_BATCH_DELAY_MS',
  'VICTORIALOGS_OTLP_MAX_QUEUE_SIZE',
  'VICTORIALOGS_OTLP_MAX_EXPORT_BATCH_SIZE'
];

describe('config VictoriaLogs OTLP settings', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of envKeys) {
      delete process.env[key];
    }
    process.env.NODE_ENV = 'production';
  });

  it('keeps VictoriaLogs OTLP disabled by default', async () => {
    const config = await import('./config.js');

    config.initConfig();

    expect(config.isVictoriaLogsOtlpEnabled()).toBe(false);
    expect(config.getVictoriaLogsOtlpEndpoint()).toBe('');
    expect(config.getVictoriaLogsOtlpHeaders()).toEqual({});
  });

  it('parses VictoriaLogs endpoint, headers, stream fields, timeout, and batching from env', async () => {
    process.env.VICTORIALOGS_OTLP_ENABLED = 'true';
    process.env.VICTORIALOGS_OTLP_ENDPOINT = 'http://victorialogs:9428/insert/opentelemetry/v1/logs';
    process.env.VICTORIALOGS_OTLP_HEADERS = 'X-Scope=prod,VL-Ignore-Fields:debug';
    process.env.VICTORIALOGS_OTLP_AUTH_HEADER_NAME = 'Authorization';
    process.env.VICTORIALOGS_OTLP_AUTH_HEADER_VALUE = 'Bearer secret-token';
    process.env.VICTORIALOGS_OTLP_STREAM_FIELDS = 'service.name,deployment.environment.name';
    process.env.VICTORIALOGS_OTLP_TIMEOUT_MS = '2500';
    process.env.VICTORIALOGS_OTLP_BATCH_DELAY_MS = '1000';
    process.env.VICTORIALOGS_OTLP_MAX_QUEUE_SIZE = '32';
    process.env.VICTORIALOGS_OTLP_MAX_EXPORT_BATCH_SIZE = '8';

    const config = await import('./config.js');

    config.initConfig();

    expect(config.isVictoriaLogsOtlpEnabled()).toBe(true);
    expect(config.getVictoriaLogsOtlpEndpoint()).toBe('http://victorialogs:9428/insert/opentelemetry/v1/logs');
    expect(config.getVictoriaLogsOtlpHeaders()).toEqual({
      'X-Scope': 'prod',
      'VL-Ignore-Fields': 'debug',
      Authorization: 'Bearer secret-token',
      'VL-Stream-Fields': 'service.name,deployment.environment.name'
    });
    expect(config.getVictoriaLogsOtlpTimeoutMs()).toBe(2500);
    expect(config.getVictoriaLogsOtlpBatchDelayMs()).toBe(1000);
    expect(config.getVictoriaLogsOtlpMaxQueueSize()).toBe(32);
    expect(config.getVictoriaLogsOtlpMaxExportBatchSize()).toBe(8);
  });

  it('parses VictoriaLogs headers from JSON', async () => {
    process.env.VICTORIALOGS_OTLP_HEADERS = '{"VL-Ignore-Fields":"debug","X-Scope":"prod"}';

    const config = await import('./config.js');

    config.initConfig();

    expect(config.getVictoriaLogsOtlpHeaders()).toEqual({
      'VL-Ignore-Fields': 'debug',
      'X-Scope': 'prod'
    });
  });
});
