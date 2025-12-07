import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export const VERSION = pkg.version;

export const METHODS = {
  CURL: 'curl',
  PUPPETEER_STEALTH: 'puppeteer_stealth',
  PUPPETEER_CAPTCHA: 'puppeteer_captcha'
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
  GENERIC: 'generic',
  DATADOME: 'datadome'
} as const;

export type CaptchaTypeValue = (typeof CAPTCHA_TYPES)[keyof typeof CAPTCHA_TYPES];

export const SCORING = {
  MIN_SCORE_THRESHOLD: 0.7,
  MIN_CONTENT_CHARS: 200
} as const;

export const DEFAULTS = {
  TIMEOUT_MS: 60000,
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  VIEWPORT_WIDTH: 1280,
  VIEWPORT_HEIGHT: 720,
  LLM_MODEL: 'meta-llama/llama-4-maverick:free',
  LLM_TEMPERATURE: 0,
  CAPTCHA_TIMEOUT: 120,
  CAPTCHA_POLLING_INTERVAL: 5000,
  MAX_REDISCOVERY_FAILURES: 2,
  LOG_RETENTION_DAYS: 7
} as const;
