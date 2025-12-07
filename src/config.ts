import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import YAML from 'yaml';

// Load .env file first if it exists
if (fs.existsSync('.env')) {
  dotenv.config();
}

/**
 * Centralized configuration schema for SmartScraper
 * All environment variables and secrets are validated here at startup
 */

const ConfigSchema = z.object({
  // Server configuration
  port: z.coerce.number().min(1).max(65535).default(5555),
  nodeEnv: z.enum(['development', 'production']).default('production'),
  
  // Data storage
  dataDir: z.string().default('./data'),
  
  // LLM Configuration (OpenRouter)
  openrouterApiKey: z.string().default(''),
  llmModel: z.string().default('meta-llama/llama-4-maverick:free'),
  llmTemperature: z.coerce.number().min(0).max(2).default(0),
  llmHttpReferer: z.string().default('https://github.com/bogorad/smartScraper'),
  llmXTitle: z.string().default('SmartScraper'),
  
  // Browser (Puppeteer) configuration
  executablePath: z.string().default('/usr/lib/chromium/chromium'),
  extensionPaths: z.string().default(''),
  proxyServer: z.string().default(''),
  
  // CAPTCHA solver configuration
  twocaptchaApiKey: z.string().default(''),
  captchaDefaultTimeout: z.coerce.number().default(120),
  captchaPollingInterval: z.coerce.number().default(5000),
  
  // Authentication
  apiToken: z.string().default(''),
  
  // Logging & Debug
  logLevel: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR', 'NONE']).default('INFO'),
  saveHtmlOnSuccessNav: z.boolean().default(false),
  
  // DOM structure extraction
  domStructureMaxTextLength: z.coerce.number().default(15),
  domStructureMinTextSizeToAnnotate: z.coerce.number().default(100)
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
    } 
    // Legacy nested check
    else if (data?.api_keys) {
      apiKeys.api_token = data.api_keys.smart_scraper || '';
      apiKeys.openrouter_api_key = data.api_keys.openrouter || '';
      apiKeys.twocaptcha_api_key = data.api_keys.twocaptcha || '';
    }
    
    return apiKeys;
  } catch (error) {
    console.warn('[CONFIG] Failed to load secrets.yaml:', error instanceof Error ? error.message : error);
    return {};
  }
}

// Map environment variable names (supporting legacy names)
function mapEnvVars(): Record<string, string | undefined> {
  const secrets = loadSecretsFromYaml();
  
  return {
    // Server
    port: process.env.PORT,
    nodeEnv: process.env.NODE_ENV,
    
    // Data storage
    dataDir: process.env.DATA_DIR,
    
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
    
    // Auth
    apiToken: process.env.API_TOKEN || process.env.SMART_SCRAPER || secrets.api_token,
    
    // Logging
    logLevel: process.env.LOG_LEVEL,
    saveHtmlOnSuccessNav: process.env.SAVE_HTML_ON_SUCCESS_NAV,
    
    // DOM
    domStructureMaxTextLength: process.env.DOM_STRUCTURE_MAX_TEXT_LENGTH,
    domStructureMinTextSizeToAnnotate: process.env.DOM_STRUCTURE_MIN_TEXT_SIZE_TO_ANNOTATE
  };
}

// Parse and validate config
function parseConfig(): Config {
  const envVars = mapEnvVars();
  
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
      console.error('[CONFIG] Validation failed:\n' + messages);
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
  return paths.split(',').map(p => p.trim()).filter(Boolean);
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

export function getSaveHtmlOnSuccessNav(): boolean {
  return getConfig().saveHtmlOnSuccessNav;
}

export function getDomStructureMaxTextLength(): number {
  return getConfig().domStructureMaxTextLength;
}

export function getDomStructureMinTextSizeToAnnotate(): number {
  return getConfig().domStructureMinTextSizeToAnnotate;
}
