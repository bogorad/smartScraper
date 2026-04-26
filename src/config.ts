import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import YAML from 'yaml';
import { DEFAULTS } from './constants.js';
import { logger } from './utils/logger.js';

// Load .env file first if it exists
if (fs.existsSync('.env')) {
  dotenv.config();
}

/**
 * Centralized configuration schema for SmartScraper
 * All environment variables and secrets are validated here at startup
 */

const booleanFromEnv = z.preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean());

const ConfigSchema = z.object({
  // Server configuration
  port: z.coerce.number().min(1).max(65535).default(DEFAULTS.PORT),
  nodeEnv: z.enum(['development', 'production']).default(DEFAULTS.NODE_ENV),

  // Scraping concurrency
  concurrency: z.coerce
    .number()
    .min(DEFAULTS.CONCURRENCY_MIN)
    .max(DEFAULTS.CONCURRENCY_MAX)
    .default(DEFAULTS.CONCURRENCY),

  // Data storage
  dataDir: z.string().default(DEFAULTS.DATA_DIR),
  logDir: z.string().optional(),

  // LLM Configuration (OpenRouter)
  openrouterApiKey: z.string().default(''),
  llmModel: z.string().default(DEFAULTS.LLM_MODEL),
  llmTemperature: z.coerce.number().min(0).max(2).default(DEFAULTS.LLM_TEMPERATURE),
  llmHttpReferer: z.string().default(DEFAULTS.LLM_HTTP_REFERER),
  llmXTitle: z.string().default(DEFAULTS.LLM_X_TITLE),

  // Browser (Puppeteer) configuration
  executablePath: z.string().default(DEFAULTS.EXECUTABLE_PATH),
  extensionPaths: z.string().default(DEFAULTS.EXTENSION_PATHS),
  proxyServer: z.string().default(DEFAULTS.PROXY_SERVER),

  // CAPTCHA solver configuration
  twocaptchaApiKey: z.string().default(''),
  captchaDefaultTimeout: z.coerce.number().default(DEFAULTS.CAPTCHA_TIMEOUT),
  captchaPollingInterval: z.coerce.number().default(DEFAULTS.CAPTCHA_POLLING_INTERVAL),

  // FlareSolverr configuration
  flaresolverrUrl: z.string().default(DEFAULTS.FLARESOLVERR_URL),
  flaresolverrTimeout: z.coerce.number().default(DEFAULTS.FLARESOLVERR_TIMEOUT),

  // DataDome proxy configuration (separate components)
  datadomeProxyHost: z.string().default(''),
  datadomeProxyLogin: z.string().default(''),
  datadomeProxyPassword: z.string().default(''),

  // Authentication
  apiToken: z.string().default(''),

  // Logging & Debug
  logLevel: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR', 'NONE']).default(DEFAULTS.LOG_LEVEL),
  victoriaLogsOtlpEnabled: booleanFromEnv.default(DEFAULTS.VICTORIALOGS_OTLP_ENABLED),
  victoriaLogsOtlpEndpoint: z.string().default(DEFAULTS.VICTORIALOGS_OTLP_ENDPOINT),
  victoriaLogsOtlpHeaders: z.string().default(DEFAULTS.VICTORIALOGS_OTLP_HEADERS),
  victoriaLogsOtlpAuthHeaderName: z.string().default(DEFAULTS.VICTORIALOGS_OTLP_AUTH_HEADER_NAME),
  victoriaLogsOtlpAuthHeaderValue: z.string().default(DEFAULTS.VICTORIALOGS_OTLP_AUTH_HEADER_VALUE),
  victoriaLogsOtlpStreamFields: z.string().default(DEFAULTS.VICTORIALOGS_OTLP_STREAM_FIELDS),
  victoriaLogsOtlpTimeoutMs: z.coerce.number().min(1).default(DEFAULTS.VICTORIALOGS_OTLP_TIMEOUT_MS),
  victoriaLogsOtlpBatchDelayMs: z.coerce.number().min(1).default(DEFAULTS.VICTORIALOGS_OTLP_BATCH_DELAY_MS),
  victoriaLogsOtlpMaxQueueSize: z.coerce.number().min(1).default(DEFAULTS.VICTORIALOGS_OTLP_MAX_QUEUE_SIZE),
  victoriaLogsOtlpMaxExportBatchSize: z.coerce.number().min(1).default(DEFAULTS.VICTORIALOGS_OTLP_MAX_EXPORT_BATCH_SIZE),
  saveHtmlOnSuccessNav: z
    .preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean())
    .default(DEFAULTS.SAVE_HTML_ON_SUCCESS_NAV),

  // DOM structure extraction
  domStructureMaxTextLength: z.coerce.number().default(DEFAULTS.DOM_STRUCTURE_MAX_TEXT_LENGTH),
  domStructureMinTextSizeToAnnotate: z.coerce.number().default(DEFAULTS.DOM_STRUCTURE_MIN_TEXT_SIZE_TO_ANNOTATE)
});

type Config = z.infer<typeof ConfigSchema>;

// Load secrets from YAML if available
function loadSecretsFromYaml(): Record<string, string> {
  const secretsPath = 'secrets.yaml';
  if (!fs.existsSync(secretsPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(secretsPath, 'utf-8');
    const data = YAML.parse(content);

    // Support simplified flat structure or legacy nested structure
    const apiKeys: Record<string, string> = {};

    // Flat structure check
    if (data?.smart_scraper || data?.openrouter || data?.twocaptcha) {
      apiKeys.api_token = data.smart_scraper || '';
      apiKeys.openrouter_api_key = data.openrouter || '';
      apiKeys.twocaptcha_api_key = data.twocaptcha || '';
      apiKeys.datadome_proxy_host = data.datadome_proxy_host || '';
      apiKeys.datadome_proxy_login = data.datadome_proxy_login || '';
      apiKeys.datadome_proxy_password = data.datadome_proxy_password || '';
      apiKeys.victorialogs_otlp_endpoint = data.victorialogs_otlp_endpoint || '';
      apiKeys.victorialogs_otlp_headers = data.victorialogs_otlp_headers || '';
      apiKeys.victorialogs_otlp_auth_header_name = data.victorialogs_otlp_auth_header_name || '';
      apiKeys.victorialogs_otlp_auth_header_value = data.victorialogs_otlp_auth_header_value || '';
    }
    // Legacy nested check
    else if (data?.api_keys) {
      apiKeys.api_token = data.api_keys.smart_scraper || '';
      apiKeys.openrouter_api_key = data.api_keys.openrouter || '';
      apiKeys.twocaptcha_api_key = data.api_keys.twocaptcha || '';
      apiKeys.datadome_proxy_host = data.api_keys.datadome_proxy_host || '';
      apiKeys.datadome_proxy_login = data.api_keys.datadome_proxy_login || '';
      apiKeys.datadome_proxy_password = data.api_keys.datadome_proxy_password || '';
      apiKeys.victorialogs_otlp_endpoint = data.api_keys.victorialogs_otlp_endpoint || '';
      apiKeys.victorialogs_otlp_headers = data.api_keys.victorialogs_otlp_headers || '';
      apiKeys.victorialogs_otlp_auth_header_name = data.api_keys.victorialogs_otlp_auth_header_name || '';
      apiKeys.victorialogs_otlp_auth_header_value = data.api_keys.victorialogs_otlp_auth_header_value || '';
    }

    return apiKeys;
  } catch (error) {
    logger.warn('Failed to load secrets.yaml', { error }, 'CONFIG');
    return {};
  }
}

// Map environment variable names (supporting legacy names)
function mapEnvVars(): Record<string, string | undefined> {
  const secrets = loadSecretsFromYaml();

  // Check if DEBUG is set - if so, override LOG_LEVEL to DEBUG
  const debugMode = process.env.DEBUG === 'true' || process.env.DEBUG === '1';
  const effectiveLogLevel = debugMode ? 'DEBUG' : process.env.LOG_LEVEL;

  return {
    // Server
    port: process.env.PORT,
    nodeEnv: process.env.NODE_ENV,

    // Concurrency
    concurrency: process.env.CONCURRENCY,

    // Data storage
    dataDir: process.env.DATA_DIR,
    logDir: process.env.LOG_DIR,

    // LLM
    openrouterApiKey: process.env.OPENROUTER_API_KEY || process.env.OPENROUTER || secrets.openrouter_api_key,
    llmModel: process.env.LLM_MODEL,
    llmTemperature: process.env.LLM_TEMPERATURE,
    llmHttpReferer: process.env.LLM_HTTP_REFERER,
    llmXTitle: process.env.LLM_X_TITLE,

    // Browser - support legacy PUPPETEER_EXECUTABLE_PATH and EXECUTABLE_PATH
    executablePath: process.env.EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH,
    extensionPaths: process.env.EXTENSION_PATHS,
    // Support both HTTP_PROXY and PROXY_SERVER
    proxyServer: process.env.PROXY_SERVER || process.env.HTTP_PROXY,

    // CAPTCHA
    twocaptchaApiKey: process.env.TWOCAPTCHA_API_KEY || process.env.TWOCAPTCHA || secrets.twocaptcha_api_key,
    captchaDefaultTimeout: process.env.CAPTCHA_DEFAULT_TIMEOUT,
    captchaPollingInterval: process.env.CAPTCHA_POLLING_INTERVAL,

    // FlareSolverr
    flaresolverrUrl: process.env.FLARESOLVERR_URL,
    flaresolverrTimeout: process.env.FLARESOLVERR_TIMEOUT,

    // DataDome proxy (ONLY from environment variables - sops exec-env decrypts these)
    datadomeProxyHost: process.env.DATADOME_PROXY_HOST,
    datadomeProxyLogin: process.env.DATADOME_PROXY_LOGIN,
    datadomeProxyPassword: process.env.DATADOME_PROXY_PASSWORD,

    // Auth
    apiToken: process.env.API_TOKEN || process.env.SMART_SCRAPER || secrets.api_token,

    // Logging
    logLevel: effectiveLogLevel,
    victoriaLogsOtlpEnabled: process.env.VICTORIALOGS_OTLP_ENABLED,
    victoriaLogsOtlpEndpoint: process.env.VICTORIALOGS_OTLP_ENDPOINT || secrets.victorialogs_otlp_endpoint,
    victoriaLogsOtlpHeaders: process.env.VICTORIALOGS_OTLP_HEADERS || secrets.victorialogs_otlp_headers,
    victoriaLogsOtlpAuthHeaderName:
      process.env.VICTORIALOGS_OTLP_AUTH_HEADER_NAME || secrets.victorialogs_otlp_auth_header_name,
    victoriaLogsOtlpAuthHeaderValue:
      process.env.VICTORIALOGS_OTLP_AUTH_HEADER_VALUE || secrets.victorialogs_otlp_auth_header_value,
    victoriaLogsOtlpStreamFields: process.env.VICTORIALOGS_OTLP_STREAM_FIELDS,
    victoriaLogsOtlpTimeoutMs: process.env.VICTORIALOGS_OTLP_TIMEOUT_MS,
    victoriaLogsOtlpBatchDelayMs: process.env.VICTORIALOGS_OTLP_BATCH_DELAY_MS,
    victoriaLogsOtlpMaxQueueSize: process.env.VICTORIALOGS_OTLP_MAX_QUEUE_SIZE,
    victoriaLogsOtlpMaxExportBatchSize: process.env.VICTORIALOGS_OTLP_MAX_EXPORT_BATCH_SIZE,
    saveHtmlOnSuccessNav: process.env.SAVE_HTML_ON_SUCCESS_NAV,

    // DOM
    domStructureMaxTextLength: process.env.DOM_STRUCTURE_MAX_TEXT_LENGTH,
    domStructureMinTextSizeToAnnotate: process.env.DOM_STRUCTURE_MIN_TEXT_SIZE_TO_ANNOTATE
  };
}

// Parse and validate config
function parseConfig(): Config {
  const envVars = mapEnvVars();

  // Check for concurrency clamping before validation
  const rawConcurrency = envVars.concurrency;
  if (rawConcurrency !== undefined) {
    const numVal = Number(rawConcurrency);
    if (!isNaN(numVal) && (numVal < DEFAULTS.CONCURRENCY_MIN || numVal > DEFAULTS.CONCURRENCY_MAX)) {
      logger.warn(`CONCURRENCY is outside valid range (${DEFAULTS.CONCURRENCY_MIN}-${DEFAULTS.CONCURRENCY_MAX})`, {
        concurrency: numVal,
        clampedTo: Math.max(DEFAULTS.CONCURRENCY_MIN, Math.min(DEFAULTS.CONCURRENCY_MAX, numVal))
      }, 'CONFIG');
    }
  }

  try {
    return ConfigSchema.parse(envVars);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const formatted = error.format();
      const messages = Object.entries(formatted)
        .filter(([key]) => key !== '_errors')
        .map(([key, value]) => {
          if (value && typeof value === 'object' && '_errors' in value) {
            return `${key}: ${(value as any)._errors?.join(', ') || 'Validation failed'}`;
          }
          return `${key}: Validation failed`;
        })
        .join('\n');
      logger.error('Validation failed', { messages }, 'CONFIG');
      throw new Error(`Configuration validation failed:\n${messages}`);
    }
    throw error;
  }
}

// Initialize config
let config: Config | null = null;

export function initConfig(): Config {
  if (config !== null) {
    return config;
  }

  config = parseConfig();
  return config;
}

export function getConfig(): Config {
  if (config === null) {
    throw new Error('Config not initialized. Call initConfig() first.');
  }
  return config;
}

// Re-export for convenience
export function get(): Config {
  return getConfig();
}

// Individual getters for common values
export function getPort(): number {
  return getConfig().port;
}

export function getDataDir(): string {
  return getConfig().dataDir;
}

export function getLogDir(): string {
  const config = getConfig();
  return config.logDir || path.join(config.dataDir, 'logs');
}

export function getOpenrouterApiKey(): string {
  return getConfig().openrouterApiKey;
}

export function getTwocaptchaApiKey(): string {
  return getConfig().twocaptchaApiKey;
}

export function getApiToken(): string | null {
  const token = getConfig().apiToken;
  return token ? token : null;
}

export function getExecutablePath(): string {
  return getConfig().executablePath;
}

export function getExtensionPaths(): string[] {
  const paths = getConfig().extensionPaths;
  if (!paths) return [];
  return paths
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

export function getProxyServer(): string {
  return getConfig().proxyServer;
}

export function getLlmModel(): string {
  return getConfig().llmModel;
}

export function getLlmTemperature(): number {
  return getConfig().llmTemperature;
}

export function getLlmHttpReferer(): string {
  return getConfig().llmHttpReferer;
}

export function getLlmXTitle(): string {
  return getConfig().llmXTitle;
}

export function getCaptchaDefaultTimeout(): number {
  return getConfig().captchaDefaultTimeout;
}

export function getCaptchaPollingInterval(): number {
  return getConfig().captchaPollingInterval;
}

export function getNodeEnv(): string {
  return getConfig().nodeEnv;
}

export function getLogLevel(): string {
  return getConfig().logLevel;
}

export function isVictoriaLogsOtlpEnabled(): boolean {
  return getConfig().victoriaLogsOtlpEnabled;
}

export function getVictoriaLogsOtlpEndpoint(): string {
  return getConfig().victoriaLogsOtlpEndpoint;
}

export function getVictoriaLogsOtlpHeaders(): Record<string, string> {
  const config = getConfig();
  const headers = parseHeaders(config.victoriaLogsOtlpHeaders);

  if (config.victoriaLogsOtlpAuthHeaderName && config.victoriaLogsOtlpAuthHeaderValue) {
    headers[config.victoriaLogsOtlpAuthHeaderName] = config.victoriaLogsOtlpAuthHeaderValue;
  }

  if (config.victoriaLogsOtlpStreamFields) {
    headers['VL-Stream-Fields'] = config.victoriaLogsOtlpStreamFields;
  }

  return headers;
}

export function getVictoriaLogsOtlpTimeoutMs(): number {
  return getConfig().victoriaLogsOtlpTimeoutMs;
}

export function getVictoriaLogsOtlpBatchDelayMs(): number {
  return getConfig().victoriaLogsOtlpBatchDelayMs;
}

export function getVictoriaLogsOtlpMaxQueueSize(): number {
  return getConfig().victoriaLogsOtlpMaxQueueSize;
}

export function getVictoriaLogsOtlpMaxExportBatchSize(): number {
  return getConfig().victoriaLogsOtlpMaxExportBatchSize;
}

export function getSaveHtmlOnSuccessNav(): boolean {
  return getConfig().saveHtmlOnSuccessNav;
}

export function getDomStructureMaxTextLength(): number {
  return getConfig().domStructureMaxTextLength;
}

export function getDomStructureMinTextSizeToAnnotate(): number {
  return getConfig().domStructureMinTextSizeToAnnotate;
}

export function getDatadomeProxyHost(): string {
  return getConfig().datadomeProxyHost;
}

export function getDatadomeProxyLogin(): string {
  return getConfig().datadomeProxyLogin;
}

export function getDatadomeProxyPassword(): string {
  return getConfig().datadomeProxyPassword;
}

/**
 * Check if debug mode is enabled via DEBUG env var.
 * This can be called before config is initialized.
 */
export function isDebugMode(): boolean {
  return process.env.DEBUG === 'true' || process.env.DEBUG === '1';
}

export function getConcurrency(): number {
  return getConfig().concurrency;
}

export function getFlaresolverrUrl(): string {
  return getConfig().flaresolverrUrl;
}

export function getFlaresolverrTimeout(): number {
  return getConfig().flaresolverrTimeout;
}

function parseHeaders(rawHeaders: string): Record<string, string> {
  const trimmed = rawHeaders.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith('{')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('VICTORIALOGS_OTLP_HEADERS must be a JSON object or comma-separated header list.');
    }

    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
  }

  const headers: Record<string, string> = {};
  for (const header of trimmed.split(/[,\n]/)) {
    const separatorIndex = header.includes('=') ? header.indexOf('=') : header.indexOf(':');
    if (separatorIndex === -1) {
      throw new Error('VICTORIALOGS_OTLP_HEADERS entries must use Header=Value or Header:Value.');
    }

    const key = header.slice(0, separatorIndex).trim();
    const value = header.slice(separatorIndex + 1).trim();
    if (key && value) {
      headers[key] = value;
    }
  }

  return headers;
}
