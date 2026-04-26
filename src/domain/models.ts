import type { MethodValue, OutputTypeValue, ErrorTypeValue, CaptchaTypeValue, ProxyModeValue } from '../constants.js';

export type SiteConfigMethod = 'curl' | 'chrome';
export type SiteConfigCaptcha =
  | 'none'
  | 'datadome'
  | 'recaptcha'
  | 'turnstile'
  | 'hcaptcha'
  | 'unsupported';
export type SiteConfigProxy = 'none' | 'default' | 'datadome';

export interface SiteConfig {
  domainPattern: string;
  xpathMainContent: string;
  lastSuccessfulScrapeTimestamp?: string;
  failureCountSinceLastSuccess: number;
  discoveredByLlm?: boolean;
  siteSpecificHeaders?: Record<string, string>;
  siteCleanupClasses?: string[];
  userAgent?: string;
  method?: SiteConfigMethod;
  captcha?: SiteConfigCaptcha;
  proxy?: SiteConfigProxy;
  needsProxy?: ProxyModeValue;
}

export interface ScrapeOptions {
  outputType?: OutputTypeValue;
  proxyDetails?: { server: string };
  userAgentString?: string;
  requestHeaders?: Record<string, string>;
  timeoutMs?: number;
  debugContextId?: string;
  xpathOverride?: string;
  debug?: boolean;
  disableDiscovery?: boolean;
}

export interface ScrapeResult {
  success: boolean;
  method?: MethodValue;
  xpath?: string;
  data?: string | object;
  rawHtmlSnapshotPath?: string;
  errorType?: ErrorTypeValue;
  error?: string;
  details?: unknown;
}

export interface ScrapeContext {
  targetUrl: string;
  normalizedDomain: string;
  siteConfig?: SiteConfig;
  methodAttempted?: MethodValue;
  proxyDetails?: { server: string };
  userAgentString?: string;
  debugContextId?: string;
}

export interface ElementDetails {
  xpath: string;
  textLength: number;
  linkDensity: number;
  paragraphCount: number;
  headingCount: number;
  hasMedia: boolean;
  domDepth: number;
  semanticScore: number;
  unwantedTagScore: number;
}

export interface LlmXPathSuggestion {
  xpath: string;
  explanation?: string;
}

export interface LoadPageOptions {
  timeout?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  proxy?: string;
  userAgentString?: string;
  headers?: Record<string, string>;
}

export interface CaptchaSolveInput {
  pageId: string;
  pageUrl: string;
  captchaTypeHint?: CaptchaTypeValue;
  proxyDetails?: { server: string };
  userAgentString?: string;
  siteKey?: string;
  captchaUrl?: string;
}

export interface CaptchaSolveResult {
  solved: boolean;
  updatedCookie?: string;
  reason?: string;
  token?: string;
}

export interface Stats {
  scrapeTotal: number;
  failTotal: number;
  todayDate: string;
  scrapeToday: number;
  failToday: number;
  domainCounts: Record<string, number>;
}

export interface LogEntry {
  ts: string;
  domain: string;
  url: string;
  success: boolean;
  method?: MethodValue;
  xpath?: string;
  contentLength?: number;
  errorType?: ErrorTypeValue;
  error?: string;
  ms: number;
}
