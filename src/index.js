// src/index.js
import dotenv from 'dotenv';
import { CoreScraperEngine } from './core/engine.js';
import { logger } from './utils/logger.js';
import { isValidUrl, normalizeDomain } from './utils/url-helpers.js';
// Import BOTH OUTPUT_TYPES and METHODS from constants.js
import { OUTPUT_TYPES, METHODS } from './constants.js'; // CORRECTED IMPORT
import { ScraperError, ConfigurationError, NetworkError, LLMError, CaptchaError, ExtractionError } from './utils/error-handler.js';

dotenv.config();

let defaultEngineInstance = null;

function getDefaultEngine() {
  if (!defaultEngineInstance) {
    logger.debug('[getDefaultEngine] Initializing default CoreScraperEngine instance.');
    defaultEngineInstance = new CoreScraperEngine();
    logger.debug('[getDefaultEngine] Default CoreScraperEngine instance initialized.');
  }
  return defaultEngineInstance;
}

async function scrapeUrl(url, options = {}) {
  const {
    outputType = OUTPUT_TYPES.CONTENT_ONLY, // OUTPUT_TYPES is used here
    proxyDetails = null,
    userAgentString = null
  } = options;

  const engine = getDefaultEngine();
  const scraperSettings = engine.configs?.scraper;

  if (scraperSettings && scraperSettings.debug) {
    logger.debug(`[DEBUG_MODE][scrapeUrl] Received URL for validation: "${url}"`);
    if (url === null || url === undefined) {
        logger.debug(`[DEBUG_MODE][scrapeUrl] Input URL is null or undefined. Type: ${typeof url}`);
    } else {
        logger.debug(`[DEBUG_MODE][scrapeUrl] Type of input URL: ${typeof url}, Length: ${url.length}`);
        const charCodes = [];
        for (let i = 0; i < url.length; i++) {
            charCodes.push(url.charCodeAt(i));
        }
        logger.debug(`[DEBUG_MODE][scrapeUrl] Character codes for input URL: [${charCodes.join(', ')}]`);
    }
  }

  if (!isValidUrl(url)) {
    const errorMsg = `Invalid URL provided to scrapeUrl: ${url}`;
    if (scraperSettings && scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE][scrapeUrl] isValidUrl returned false for URL: "${url}". Throwing ConfigurationError.`);
    }
    throw new ConfigurationError(errorMsg, { url });
  }

  if (scraperSettings && scraperSettings.debug) {
    logger.debug(`[DEBUG_MODE][scrapeUrl] URL "${url}" passed validation.`);
  }


  if (!Object.values(OUTPUT_TYPES).includes(outputType)) { // OUTPUT_TYPES is used here
    const errorMsg = `Invalid outputType specified: ${outputType}. Must be one of ${Object.values(OUTPUT_TYPES).join(', ')}`;
    if (scraperSettings && scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE][scrapeUrl] Invalid outputType: "${outputType}". Throwing ConfigurationError.`);
    }
    throw new ConfigurationError(errorMsg, { outputType });
  }

  logger.debug(`[scrapeUrl] Initiating scrape for URL: ${url} with options:`, {outputType, proxyDetails: !!proxyDetails, userAgentString: !!userAgentString});

  try {
    const result = await engine.scrape(url, proxyDetails, userAgentString, outputType);
    if (scraperSettings && scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE][scrapeUrl] engine.scrape returned for ${url}. Success: ${result.success}`);
    }
    logger.info(`[scrapeUrl] Result for ${url}: Success=${result.success}`, result.success ? `Method=${result.method}, XPath=${result.xpath || 'N/A'}` : `Error=${result.error}`);
    return result;
  } catch (error) {
    if (scraperSettings && scraperSettings.debug) {
      logger.debug(`[DEBUG_MODE][scrapeUrl] Caught error during engine.scrape for ${url}. Error Name: ${error.name}, Message: ${error.message}`);
      logger.error(`[DEBUG_MODE] Full error object caught in scrapeUrl for ${url}:`, error);
      if (error instanceof NetworkError && error.details && error.details.originalError && error.details.originalError.isAxiosError) {
        logger.error('[DEBUG_MODE] Axios error details:', {
          message: error.details.originalError.message,
          code: error.details.originalError.code,
          status: error.details.originalError.response?.status,
          config: error.details.originalError.config ? 'Exists (details omitted for brevity)' : 'Missing',
          response: error.details.originalError.response ? { status: error.details.originalError.response.status, data: typeof error.details.originalError.response.data === 'string' ? error.details.originalError.response.data.substring(0,200) + '...' : 'Non-string data' } : 'Missing',
        });
      }
      if (error.stack) logger.error(`[DEBUG_MODE] Error stack: ${error.stack}`);
    }

    if (error instanceof ScraperError) {
      logger.error(`${error.name} during scrapeUrl for ${url}: ${error.message}`, error.details ? JSON.stringify(error.details).substring(0, 300) + '...' : '');
      return {
        success: false,
        url: url,
        error: error.message,
        errorType: error.name.replace('Error', '').toLowerCase(),
        details: error.details,
        timestamp: error.timestamp
      };
    } else {
      logger.error(`[CRITICAL_INTERNAL_SCRIPT_ERROR] Uncaught non-ScraperError in scrapeUrl for ${url}. This indicates a bug. Error:`, error);
      throw error;
    }
  }
}

// Ensure all exported names are defined or imported in this module
export { scrapeUrl, OUTPUT_TYPES, METHODS }; // METHODS is now imported
