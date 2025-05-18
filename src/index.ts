// src/index.ts
import dotenv from 'dotenv';
import { CoreScraperEngine, ScrapeResult } from './core/engine.js';
import { OUTPUT_TYPES, METHODS, OutputTypeValue } from './constants.js';
import { ConfigurationError, ScraperError } from './utils/error-handler.js';
import { isValidUrl } from './utils/url-helpers.js';
import { logger } from './utils/logger.js';
import { ProxyDetails as PuppeteerProxyDetails } from './browser/puppeteer-controller.js';
import { ProxyDetails as CurlProxyDetails } from './network/curl-handler.js';


dotenv.config();

let defaultEngineInstance: CoreScraperEngine | null = null;

function getDefaultEngine(): CoreScraperEngine {
  if (!defaultEngineInstance) {
    if (logger.isDebugging()) {
        logger.debug('[getDefaultEngine] Initializing default CoreScraperEngine instance.');
    }
    defaultEngineInstance = new CoreScraperEngine();
    if (logger.isDebugging()) {
        logger.debug('[getDefaultEngine] Default CoreScraperEngine instance initialized.');
    }
  }
  return defaultEngineInstance;
}

interface ScrapeUrlOptions {
    outputType?: OutputTypeValue;
    proxyDetails?: PuppeteerProxyDetails | CurlProxyDetails | null;
    userAgentString?: string | null;
}

async function scrapeUrl(url: string, options: ScrapeUrlOptions = {}): Promise<ScrapeResult> {
  const {
    outputType = OUTPUT_TYPES.CONTENT_ONLY as OutputTypeValue,
    proxyDetails = null,
    userAgentString = null,
  } = options;

  const engine = getDefaultEngine();

  if (logger.isDebugging()) {
    logger.debug(`[DEBUG_MODE][scrapeUrl] Received URL for validation: "${url}"`);
  }
  if (url === null || url === undefined) {
    if (logger.isDebugging()) {
        logger.debug(`[DEBUG_MODE][scrapeUrl] Input URL is null or undefined. Type: ${typeof url}`);
    }
    const errorMsg = 'URL cannot be null or undefined.';
    throw new ConfigurationError(errorMsg, { url });
  }
  if (typeof url !== 'string' || url.length === 0) {
    if (logger.isDebugging()) {
        logger.debug(`[DEBUG_MODE][scrapeUrl] Type of input URL: ${typeof url}, Length: ${url.length}`);
    }
    const errorMsg = `Invalid URL provided: must be a non-empty string. Received: "${url}" (type: ${typeof url})`;
    if (logger.isDebugging()) {
        const charCodes: number[] = [];
        if (typeof url === 'string') { // Check again in case it's an empty string
            for (let i = 0; i < url.length; i++) {
                charCodes.push(url.charCodeAt(i));
            }
        }
        logger.debug(`[DEBUG_MODE][scrapeUrl] Character codes for input URL: [${charCodes.join(', ')}]`);
    }
    throw new ConfigurationError(errorMsg, { url });
  }

  if (!isValidUrl(url)) {
    const errorMsg = `Invalid URL format: ${url}`;
    if (logger.isDebugging()) {
        logger.debug(`[DEBUG_MODE][scrapeUrl] isValidUrl returned false for URL: "${url}". Throwing ConfigurationError.`);
    }
    throw new ConfigurationError(errorMsg, { url });
  }
  if (logger.isDebugging()) {
    logger.debug(`[DEBUG_MODE][scrapeUrl] URL "${url}" passed validation.`);
  }

  if (!Object.values(OUTPUT_TYPES).includes(outputType)) {
    const errorMsg = `Invalid outputType specified: ${outputType}. Must be one of ${Object.values(OUTPUT_TYPES).join(', ')}`;
    if (logger.isDebugging()) {
        logger.debug(`[DEBUG_MODE][scrapeUrl] Invalid outputType: "${outputType}". Throwing ConfigurationError.`);
    }
    throw new ConfigurationError(errorMsg, { outputType });
  }

  try {
    logger.debug(`[scrapeUrl] Initiating scrape for URL: ${url} with options:`, {outputType, proxyDetails: !!proxyDetails, userAgentString: !!userAgentString});
    const result = await engine.scrape(url, proxyDetails, userAgentString, outputType);
    if (logger.isDebugging()) {
        logger.debug(`[DEBUG_MODE][scrapeUrl] engine.scrape returned for ${url}. Success: ${result.success}`);
    }
    logger.info(`[scrapeUrl] Result for ${url}: Success=${result.success}`, result.success ? `Method=${result.method}, XPath=${result.xpath || 'N/A'}` : `Error=${result.error}`);
    return result;
  } catch (error: any) {
    if (logger.isDebugging()) {
        logger.debug(`[DEBUG_MODE][scrapeUrl] Caught error during engine.scrape for ${url}. Error Name: ${error.name}, Message: ${error.message}`);
        logger.error(`[DEBUG_MODE] Full error object caught in scrapeUrl for ${url}:`, error);
    }

    if (error instanceof ScraperError) {
      if (logger.isDebugging() && error.details?.originalErrorName === 'AxiosError') {
        logger.error('[DEBUG_MODE] Axios error details:', {
            // @ts-ignore
            config: error.details.originalError.config,
            // @ts-ignore
            request: error.details.originalError.request ? 'Exists' : 'Missing',
            // @ts-ignore
            response: error.details.originalError.response ? { status: error.details.originalError.response.status, data: typeof error.details.originalError.response.data === 'string' ? error.details.originalError.response.data.substring(0,200) + '...' : 'Non-string data' } : 'Missing',
        });
      }
      if (logger.isDebugging() && error.stack) logger.error(`[DEBUG_MODE] Error stack: ${error.stack}`);
      
      logger.error(`${error.name} during scrapeUrl for ${url}: ${error.message}`, error.details ? JSON.stringify(error.details).substring(0, 300) + '...' : '');
      return {
        success: false,
        error: error.message,
        errorType: error.name.replace('Error', '').toLowerCase(),
        details: error.details,
        outputType: outputType,
      };
    }
    // For truly unexpected errors not caught by CoreScraperEngine's handlers
    logger.error(`[CRITICAL_INTERNAL_SCRIPT_ERROR] Uncaught non-ScraperError in scrapeUrl for ${url}. This indicates a bug. Error:`, error);
    return {
      success: false,
      error: `Critical internal error: ${error.message}`,
      errorType: 'internal_script_error',
      details: { originalErrorName: error.name, originalErrorMessage: error.message, stack: error.stack },
      outputType: outputType,
    };
  }
}

export { scrapeUrl, OUTPUT_TYPES, METHODS, ScrapeResult, ScrapeUrlOptions };
