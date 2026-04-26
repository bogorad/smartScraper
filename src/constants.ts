import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export const VERSION = pkg.version;

export const METHODS = {
  CURL: 'curl',
  CHROME: 'chrome'
} as const;

export type MethodValue = (typeof METHODS)[keyof typeof METHODS];

export const OUTPUT_TYPES = {
  CONTENT_ONLY: 'content_only',
  MARKDOWN: 'markdown',
  CLEANED_HTML: 'cleaned_html',
  FULL_HTML: 'full_html',
  METADATA_ONLY: 'metadata_only'
} as const;

export type OutputTypeValue = (typeof OUTPUT_TYPES)[keyof typeof OUTPUT_TYPES];

export const ERROR_TYPES = {
  NETWORK: 'NETWORK',
  CAPTCHA: 'CAPTCHA',
  LLM: 'LLM',
  CONFIGURATION: 'CONFIGURATION',
  EXTRACTION: 'EXTRACTION',
  UNKNOWN: 'UNKNOWN'
} as const;

export type ErrorTypeValue = (typeof ERROR_TYPES)[keyof typeof ERROR_TYPES];

export const CAPTCHA_TYPES = {
  NONE: 'none',
  DATADOME: 'datadome',
  RECAPTCHA: 'recaptcha',
  TURNSTILE: 'turnstile',
  HCAPTCHA: 'hcaptcha',
  UNSUPPORTED: 'unsupported'
} as const;

export type CaptchaTypeValue = (typeof CAPTCHA_TYPES)[keyof typeof CAPTCHA_TYPES];

export const SCORING = {
  MIN_SCORE_THRESHOLD: 0.7,
  MIN_CONTENT_CHARS: 200
} as const;

export const PROXY_MODES = {
  OFF: 'off',
  DATADOME: 'datadome'
} as const;

export type ProxyModeValue = (typeof PROXY_MODES)[keyof typeof PROXY_MODES];

export const DEFAULTS = {
  PORT: 5555,
  NODE_ENV: 'production',
  CONCURRENCY: 1,
  CONCURRENCY_MIN: 1,
  CONCURRENCY_MAX: 20,
  DATA_DIR: './data',
  TIMEOUT_MS: 120000,
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  VIEWPORT_WIDTH: 1280,
  VIEWPORT_HEIGHT: 720,
  BROWSER_DUMPIO: false,
  BROWSER_CONSOLE_CAPTURE: false,
  BROWSER_EXTENSION_INIT_WAIT_MS: 2000,
  BROWSER_EXTENSION_CONTENT_MAX_WAIT_MS: 15000,
  BROWSER_EXTENSION_CONTENT_MIN_LENGTH: 1000,
  BROWSER_NON_EXTENSION_POST_NAV_WAIT_MS: 3000,
  EXECUTABLE_PATH: '/usr/lib/chromium/chromium',
  EXTENSION_PATHS: '',
  PROXY_SERVER: '',
  LLM_MODEL: 'meta-llama/llama-4-maverick:free',
  LLM_TEMPERATURE: 0,
  LLM_HTTP_REFERER:
    'https://github.com/bogorad/smartScraper',
  LLM_X_TITLE: 'SmartScraper',
  CAPTCHA_TIMEOUT: 120,
  CAPTCHA_POLLING_INTERVAL: 5000,
  LOG_LEVEL: 'INFO',
  SAVE_HTML_ON_SUCCESS_NAV: false,
  VICTORIALOGS_OTLP_ENABLED: true,
  VICTORIALOGS_OTLP_ENDPOINT: '',
  VICTORIALOGS_OTLP_HEADERS: '',
  VICTORIALOGS_OTLP_AUTH_HEADER_NAME: '',
  VICTORIALOGS_OTLP_AUTH_HEADER_VALUE: '',
  VICTORIALOGS_OTLP_STREAM_FIELDS: '',
  VICTORIALOGS_OTLP_TIMEOUT_MS: 10000,
  VICTORIALOGS_OTLP_BATCH_DELAY_MS: 5000,
  VICTORIALOGS_OTLP_MAX_QUEUE_SIZE: 2048,
  VICTORIALOGS_OTLP_MAX_EXPORT_BATCH_SIZE: 512,
  DOM_STRUCTURE_MAX_TEXT_LENGTH: 15,
  DOM_STRUCTURE_MIN_TEXT_SIZE_TO_ANNOTATE: 100,
  MAX_REDISCOVERY_FAILURES: 2,
  LOG_RETENTION_DAYS: 7,
  PROXY_SESSION_MINUTES: 2
} as const;
