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
  'TRUST_PROXY_HEADERS',
  'BROWSER_DUMPIO',
  'BROWSER_CONSOLE_CAPTURE',
  'BROWSER_EXTENSION_INIT_WAIT_MS',
  'BROWSER_EXTENSION_CONTENT_MAX_WAIT_MS',
  'BROWSER_EXTENSION_CONTENT_MIN_LENGTH',
  'BROWSER_NON_EXTENSION_POST_NAV_WAIT_MS',
  'BROWSER_UNSAFE_NO_SANDBOX',
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
    expect(config.getTrustProxyHeaders()).toBe(false);
    expect(config.getBrowserDumpio()).toBe(DEFAULTS.BROWSER_DUMPIO);
    expect(config.getBrowserConsoleCapture()).toBe(DEFAULTS.BROWSER_CONSOLE_CAPTURE);
    expect(config.getBrowserExtensionInitWaitMs()).toBe(DEFAULTS.BROWSER_EXTENSION_INIT_WAIT_MS);
    expect(config.getBrowserExtensionContentMaxWaitMs()).toBe(DEFAULTS.BROWSER_EXTENSION_CONTENT_MAX_WAIT_MS);
    expect(config.getBrowserExtensionContentMinLength()).toBe(DEFAULTS.BROWSER_EXTENSION_CONTENT_MIN_LENGTH);
    expect(config.getBrowserNonExtensionPostNavWaitMs()).toBe(DEFAULTS.BROWSER_NON_EXTENSION_POST_NAV_WAIT_MS);
    expect(config.getBrowserUnsafeNoSandbox()).toBe(false);
    expect(config.getCaptchaDefaultTimeout()).toBe(DEFAULTS.CAPTCHA_TIMEOUT);
    expect(config.getCaptchaPollingInterval()).toBe(DEFAULTS.CAPTCHA_POLLING_INTERVAL);
    expect(config.getLogLevel()).toBe(DEFAULTS.LOG_LEVEL);
    expect(config.getDomStructureMaxTextLength()).toBe(DEFAULTS.DOM_STRUCTURE_MAX_TEXT_LENGTH);
    expect(config.getDomStructureMinTextSizeToAnnotate()).toBe(DEFAULTS.DOM_STRUCTURE_MIN_TEXT_SIZE_TO_ANNOTATE);
  });

  it('does not load .env values when importing config', async () => {
    fs.writeFileSync('.env', 'PORT=4321\nAPI_TOKEN=token-from-dotenv\n');

    const config = await import('./config.js');

    expect(process.env.PORT).toBeUndefined();
    expect(process.env.API_TOKEN).toBeUndefined();

    config.initConfig();

    expect(config.getPort()).toBe(DEFAULTS.PORT);
    expect(config.getApiToken()).toBeNull();
  });

  it('loads .env values only through explicit setup', async () => {
    fs.writeFileSync('.env', 'PORT=4321\nAPI_TOKEN=token-from-dotenv\n');

    const config = await import('./config.js');

    config.loadDotenvConfig();
    config.initConfig();

    expect(config.getPort()).toBe(4321);
    expect(config.getApiToken()).toBe('token-from-dotenv');
  });

  it('keeps VictoriaLogs OTLP enabled by default', async () => {
    const config = await import('./config.js');

    config.initConfig();

    expect(config.isVictoriaLogsOtlpEnabled()).toBe(true);
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

  it('requires explicit config before trusting proxy headers', async () => {
    let config = await import('./config.js');
    config.initConfig();
    expect(config.getTrustProxyHeaders()).toBe(false);

    vi.resetModules();
    process.env.TRUST_PROXY_HEADERS = 'true';
    config = await import('./config.js');
    config.initConfig();
    expect(config.getTrustProxyHeaders()).toBe(true);
  });

  it('does not parse secrets.yaml at runtime', async () => {
    fs.writeFileSync(
      'secrets.yaml',
      [
        'smart_scraper: token-from-yaml',
        'openrouter: openrouter-from-yaml',
        'twocaptcha: twocaptcha-from-yaml',
        'default_socks5_proxy: socks5://yaml-default.example:1080',
        'datadome_proxy_host: yaml-datadome.example:8000'
      ].join('\n')
    );

    const config = await import('./config.js');

    config.initConfig();

    expect(config.getProxyServer()).toBe('');
    expect(config.getApiToken()).toBeNull();
    expect(config.getOpenrouterApiKey()).toBe('');
    expect(config.getTwocaptchaApiKey()).toBe('');
    expect(config.getDatadomeProxyHost()).toBe('');
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

  it('requires an explicit opt-in before disabling the Chromium sandbox', async () => {
    process.env.BROWSER_UNSAFE_NO_SANDBOX = 'true';

    const config = await import('./config.js');

    config.initConfig();

    expect(config.getBrowserUnsafeNoSandbox()).toBe(true);
  });

  it('rejects browser waits below ADR-017 safeguards', async () => {
    process.env.BROWSER_NON_EXTENSION_POST_NAV_WAIT_MS = '2999';

    const config = await import('./config.js');

    expect(() => config.initConfig()).toThrow(/browserNonExtensionPostNavWaitMs/);
  });

  it('loads uppercase env values exported by the dev secrets wrapper', async () => {
    process.env.SMART_SCRAPER = 'token-from-env';
    process.env.OPENROUTER = 'openrouter-from-env';
    process.env.TWOCAPTCHA = 'twocaptcha-from-env';
    process.env.DATADOME_PROXY_HOST = 'datadome.example:8000';
    process.env.DATADOME_PROXY_LOGIN = 'datadome-login';
    process.env.DATADOME_PROXY_PASSWORD = 'datadome-password';
    process.env.DEFAULT_SOCKS5_PROXY = 'socks5://default.example:1080';
    process.env.VICTORIALOGS_OTLP_ENDPOINT = 'http://victorialogs:9428/insert/opentelemetry/v1/logs';
    process.env.VICTORIALOGS_OTLP_AUTH_HEADER_NAME = 'Authorization';
    process.env.VICTORIALOGS_OTLP_AUTH_HEADER_VALUE = 'Bearer vl-token';

    const config = await import('./config.js');

    config.initConfig();

    expect(config.getApiToken()).toBe('token-from-env');
    expect(config.getOpenrouterApiKey()).toBe('openrouter-from-env');
    expect(config.getTwocaptchaApiKey()).toBe('twocaptcha-from-env');
    expect(config.getDatadomeProxyHost()).toBe('datadome.example:8000');
    expect(config.getDatadomeProxyLogin()).toBe('datadome-login');
    expect(config.getDatadomeProxyPassword()).toBe('datadome-password');
    expect(config.getProxyServer()).toBe('socks5://default.example:1080');
    expect(config.getVictoriaLogsOtlpEndpoint()).toBe('http://victorialogs:9428/insert/opentelemetry/v1/logs');
    expect(config.getVictoriaLogsOtlpHeaders()).toEqual({
      Authorization: 'Bearer vl-token'
    });
  });
});
