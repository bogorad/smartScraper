import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from './constants.js';

const envKeys = [
  'PORT',
  'NODE_ENV',
  'CONCURRENCY',
  'DATA_DIR',
  'API_TOKEN',
  'SMART_SCRAPER',
  'OPENROUTER_API_KEY',
  'OPENROUTER',
  'TWOCAPTCHA_API_KEY',
  'TWOCAPTCHA',
  'LLM_MODEL',
  'LLM_TEMPERATURE',
  'LLM_HTTP_REFERER',
  'LLM_X_TITLE',
  'EXECUTABLE_PATH',
  'EXTENSION_PATHS',
  'PROXY_SERVER',
  'CAPTCHA_DEFAULT_TIMEOUT',
  'CAPTCHA_POLLING_INTERVAL',
  'FLARESOLVERR_URL',
  'FLARESOLVERR_TIMEOUT',
  'DATADOME_PROXY_HOST',
  'DATADOME_PROXY_LOGIN',
  'DATADOME_PROXY_PASSWORD',
  'LOG_LEVEL',
  'VICTORIALOGS_OTLP_ENABLED',
  'VICTORIALOGS_OTLP_ENDPOINT',
  'VICTORIALOGS_OTLP_HEADERS',
  'VICTORIALOGS_OTLP_AUTH_HEADER_NAME',
  'VICTORIALOGS_OTLP_AUTH_HEADER_VALUE',
  'VICTORIALOGS_OTLP_STREAM_FIELDS',
  'VICTORIALOGS_OTLP_TIMEOUT_MS',
  'VICTORIALOGS_OTLP_BATCH_DELAY_MS',
  'VICTORIALOGS_OTLP_MAX_QUEUE_SIZE',
  'VICTORIALOGS_OTLP_MAX_EXPORT_BATCH_SIZE',
  'SAVE_HTML_ON_SUCCESS_NAV',
  'DOM_STRUCTURE_MAX_TEXT_LENGTH',
  'DOM_STRUCTURE_MIN_TEXT_SIZE_TO_ANNOTATE'
];

describe('config VictoriaLogs OTLP settings', () => {
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-scraper-config-'));
    process.chdir(tempDir);
    for (const key of envKeys) {
      delete process.env[key];
    }
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses centralized runtime defaults when env values are unset', async () => {
    const config = await import('./config.js');

    config.initConfig();

    expect(config.getPort()).toBe(DEFAULTS.PORT);
    expect(config.getConcurrency()).toBe(DEFAULTS.CONCURRENCY);
    expect(config.getDataDir()).toBe(DEFAULTS.DATA_DIR);
    expect(config.getLlmModel()).toBe(DEFAULTS.LLM_MODEL);
    expect(config.getLlmTemperature()).toBe(DEFAULTS.LLM_TEMPERATURE);
    expect(config.getExecutablePath()).toBe(DEFAULTS.EXECUTABLE_PATH);
    expect(config.getCaptchaDefaultTimeout()).toBe(DEFAULTS.CAPTCHA_TIMEOUT);
    expect(config.getCaptchaPollingInterval()).toBe(DEFAULTS.CAPTCHA_POLLING_INTERVAL);
    expect(config.getFlaresolverrTimeout()).toBe(DEFAULTS.FLARESOLVERR_TIMEOUT);
    expect(config.getLogLevel()).toBe(DEFAULTS.LOG_LEVEL);
    expect(config.getDomStructureMaxTextLength()).toBe(DEFAULTS.DOM_STRUCTURE_MAX_TEXT_LENGTH);
    expect(config.getDomStructureMinTextSizeToAnnotate()).toBe(DEFAULTS.DOM_STRUCTURE_MIN_TEXT_SIZE_TO_ANNOTATE);
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
