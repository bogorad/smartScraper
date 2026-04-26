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
  'DEFAULT_SOCKS5_PROXY',
  'HTTP_PROXY',
  'BROWSER_DUMPIO',
  'BROWSER_CONSOLE_CAPTURE',
  'BROWSER_EXTENSION_INIT_WAIT_MS',
  'BROWSER_EXTENSION_CONTENT_MAX_WAIT_MS',
  'BROWSER_EXTENSION_CONTENT_MIN_LENGTH',
  'BROWSER_NON_EXTENSION_POST_NAV_WAIT_MS',
  'CAPTCHA_DEFAULT_TIMEOUT',
  'CAPTCHA_POLLING_INTERVAL',
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
    expect(config.getBrowserDumpio()).toBe(DEFAULTS.BROWSER_DUMPIO);
    expect(config.getBrowserConsoleCapture()).toBe(DEFAULTS.BROWSER_CONSOLE_CAPTURE);
    expect(config.getBrowserExtensionInitWaitMs()).toBe(DEFAULTS.BROWSER_EXTENSION_INIT_WAIT_MS);
    expect(config.getBrowserExtensionContentMaxWaitMs()).toBe(DEFAULTS.BROWSER_EXTENSION_CONTENT_MAX_WAIT_MS);
    expect(config.getBrowserExtensionContentMinLength()).toBe(DEFAULTS.BROWSER_EXTENSION_CONTENT_MIN_LENGTH);
    expect(config.getBrowserNonExtensionPostNavWaitMs()).toBe(DEFAULTS.BROWSER_NON_EXTENSION_POST_NAV_WAIT_MS);
    expect(config.getCaptchaDefaultTimeout()).toBe(DEFAULTS.CAPTCHA_TIMEOUT);
    expect(config.getCaptchaPollingInterval()).toBe(DEFAULTS.CAPTCHA_POLLING_INTERVAL);
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

  it('uses DEFAULT_SOCKS5_PROXY as the default proxy unless PROXY_SERVER is set', async () => {
    process.env.DEFAULT_SOCKS5_PROXY = 'socks5://default.example:1080';
    process.env.HTTP_PROXY = 'http://legacy.example:8080';

    let config = await import('./config.js');
    config.initConfig();
    expect(config.getProxyServer()).toBe('socks5://default.example:1080');

    vi.resetModules();
    process.env.PROXY_SERVER = 'http://explicit.example:8080';
    config = await import('./config.js');
    config.initConfig();
    expect(config.getProxyServer()).toBe('http://explicit.example:8080');
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

  it('parses browser output and wait settings from env', async () => {
    process.env.BROWSER_DUMPIO = '1';
    process.env.BROWSER_CONSOLE_CAPTURE = 'true';
    process.env.BROWSER_EXTENSION_INIT_WAIT_MS = '2500';
    process.env.BROWSER_EXTENSION_CONTENT_MAX_WAIT_MS = '16000';
    process.env.BROWSER_EXTENSION_CONTENT_MIN_LENGTH = '1200';
    process.env.BROWSER_NON_EXTENSION_POST_NAV_WAIT_MS = '3500';

    const config = await import('./config.js');

    config.initConfig();

    expect(config.getBrowserDumpio()).toBe(true);
    expect(config.getBrowserConsoleCapture()).toBe(true);
    expect(config.getBrowserExtensionInitWaitMs()).toBe(2500);
    expect(config.getBrowserExtensionContentMaxWaitMs()).toBe(16000);
    expect(config.getBrowserExtensionContentMinLength()).toBe(1200);
    expect(config.getBrowserNonExtensionPostNavWaitMs()).toBe(3500);
  });

  it('rejects browser waits below ADR-017 safeguards', async () => {
    process.env.BROWSER_NON_EXTENSION_POST_NAV_WAIT_MS = '2999';

    const config = await import('./config.js');

    expect(() => config.initConfig()).toThrow(/browserNonExtensionPostNavWaitMs/);
  });

  it('loads DataDome and VictoriaLogs secrets from flat secrets.yaml keys', async () => {
    fs.writeFileSync(
      'secrets.yaml',
      [
        'smart_scraper: token-from-flat',
        'openrouter: openrouter-from-flat',
        'twocaptcha: twocaptcha-from-flat',
        'datadome_proxy_host: datadome.example:8000',
        'datadome_proxy_login: datadome-login',
        'datadome_proxy_password: datadome-password',
        'default_socks5_proxy: socks5://default.example:1080',
        'victorialogs_otlp_endpoint: http://victorialogs:9428/insert/opentelemetry/v1/logs',
        'victorialogs_otlp_auth_header_name: Authorization',
        'victorialogs_otlp_auth_header_value: Bearer vl-token'
      ].join('\n')
    );

    const config = await import('./config.js');

    config.initConfig();

    expect(config.getApiToken()).toBe('token-from-flat');
    expect(config.getOpenrouterApiKey()).toBe('openrouter-from-flat');
    expect(config.getTwocaptchaApiKey()).toBe('twocaptcha-from-flat');
    expect(config.getDatadomeProxyHost()).toBe('datadome.example:8000');
    expect(config.getDatadomeProxyLogin()).toBe('datadome-login');
    expect(config.getDatadomeProxyPassword()).toBe('datadome-password');
    expect(config.getProxyServer()).toBe('socks5://default.example:1080');
    expect(config.getVictoriaLogsOtlpEndpoint()).toBe('http://victorialogs:9428/insert/opentelemetry/v1/logs');
    expect(config.getVictoriaLogsOtlpHeaders()).toEqual({
      Authorization: 'Bearer vl-token'
    });
  });

  it('loads DataDome and VictoriaLogs secrets from nested api_keys secrets.yaml keys', async () => {
    fs.writeFileSync(
      'secrets.yaml',
      [
        'api_keys:',
        '  smart_scraper: token-from-nested',
        '  openrouter: openrouter-from-nested',
        '  twocaptcha: twocaptcha-from-nested',
        '  datadome_proxy_host: nested-datadome.example:8000',
        '  datadome_proxy_login: nested-datadome-login',
        '  datadome_proxy_password: nested-datadome-password',
        '  default_socks5_proxy: socks5://nested-default.example:1080',
        '  victorialogs_otlp_endpoint: http://nested-victorialogs:9428/insert/opentelemetry/v1/logs',
        '  victorialogs_otlp_headers: X-Scope=nested',
        '  victorialogs_otlp_auth_header_name: Authorization',
        '  victorialogs_otlp_auth_header_value: Bearer nested-vl-token'
      ].join('\n')
    );

    const config = await import('./config.js');

    config.initConfig();

    expect(config.getApiToken()).toBe('token-from-nested');
    expect(config.getOpenrouterApiKey()).toBe('openrouter-from-nested');
    expect(config.getTwocaptchaApiKey()).toBe('twocaptcha-from-nested');
    expect(config.getDatadomeProxyHost()).toBe('nested-datadome.example:8000');
    expect(config.getDatadomeProxyLogin()).toBe('nested-datadome-login');
    expect(config.getDatadomeProxyPassword()).toBe('nested-datadome-password');
    expect(config.getProxyServer()).toBe('socks5://nested-default.example:1080');
    expect(config.getVictoriaLogsOtlpEndpoint()).toBe('http://nested-victorialogs:9428/insert/opentelemetry/v1/logs');
    expect(config.getVictoriaLogsOtlpHeaders()).toEqual({
      'X-Scope': 'nested',
      Authorization: 'Bearer nested-vl-token'
    });
  });
});
