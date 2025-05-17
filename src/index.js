// src/index.js
import dotenv from 'dotenv';
// Load environment variables (if using .env file)
// This should be one of the first things to run if your configs depend on .env
dotenv.config(); // Loads .env file from project root

// Import core components and configurations
import { CoreScraperEngine } from './core/engine.js';
import { logger } from './utils/logger.js';
import { isValidUrl, normalizeDomain } from './utils/url-helpers.js';
import { OUTPUT_TYPES, DEFAULT_USER_AGENT } from './constants.js';
import {
  llmConfig,
  scraperSettings,
  captchaSolverConfig
} from '../config/index.js'; // Default configurations
import { ConfigurationError, ScraperError } from './utils/error-handler.js';


// Store a single instance of the engine if desired, or allow creating multiple
let defaultEngineInstance = null;

function getDefaultEngine() {
  if (!defaultEngineInstance) {
    // Initialize with default configurations loaded from config/index.js
    // These configs would have already picked up .env values if dotenv.config() was called.
    defaultEngineInstance = new CoreScraperEngine({
      scraperSettings, // Pass the imported scraperSettings directly
      llmConfig,       // Pass the imported llmConfig
      captchaSolverConfig // Pass the imported captchaSolverConfig
    });
  }
  return defaultEngineInstance;
}

/**
 * A high-level convenience function to scrape a URL.
 * Uses a default or shared instance of the CoreScraperEngine.
 *
 * @param {string} url - The URL to scrape.
 * @param {object} [options={}] - Optional parameters for the scrape.
 * @param {object|null} [options.proxyDetails=null] - Proxy configuration. Example: { server: 'http://user:pass@host:port' }
 * @param {string|null} [options.userAgentString=null] - Custom User-Agent string.
 * @param {string} [options.outputType='content'] - Desired output type ('content' or 'full_html').
 *                                                  See OUTPUT_TYPES in constants.js.
 * @returns {Promise<{success: boolean, data: string|null, error: string|null, method?: string, xpath?: string, message?: string, details?: object, htmlContent?: string}>}
 *          The result of the scraping attempt.
 */
async function scrapeUrl(url, options = {}) {
  const {
    proxyDetails = null,
    userAgentString = null,
    outputType = OUTPUT_TYPES.CONTENT_ONLY,
  } = options;

  if (!isValidUrl(url)) {
    const errorMsg = `Invalid URL format provided: ${url}`;
    logger.error(errorMsg);
    // For consistency, throw a ScraperError or ConfigurationError
    throw new ConfigurationError('Invalid URL format', { url });
  }

  if (!Object.values(OUTPUT_TYPES).includes(outputType)) {
    const errorMsg = `Invalid outputType specified: ${outputType}. Valid types are: ${Object.values(OUTPUT_TYPES).join(', ')}`;
    logger.error(errorMsg);
    throw new ConfigurationError('Invalid output type', {
      specifiedType: outputType,
      validTypes: Object.values(OUTPUT_TYPES)
    });
  }

  try {
    const engine = getDefaultEngine();
    const result = await engine.scrape(url, proxyDetails, userAgentString, outputType);
    return result; // engine.scrape should return a structured object
  } catch (error) {
    // Handle different types of errors
    if (error instanceof ScraperError) {
      logger.error(`${error.name} during scrapeUrl for ${url}: ${error.message}`, error.details);
      return {
        success: false,
        data: null,
        error: error.message,
        message: error.message, // Redundant but common
        details: error.details,
        errorType: error.name.replace('Error', '').toLowerCase(),
        htmlContent: error.details?.htmlContent || null
      };
    }
    // For unexpected errors
    logger.error(`Unhandled error during scrapeUrl for ${url}: ${error.message}`, error.stack);
    return {
      success: false,
      data: null,
      error: 'An unexpected error occurred during scraping.',
      message: error.message,
      details: { originalError: error.message, stack: error.stack },
      errorType: 'unhandled',
      htmlContent: null
    };
  }
}

// Export the main engine class for advanced usage and the convenience function.
export {
  CoreScraperEngine,
  scrapeUrl,
  // Export configurations and constants if consumers might need them
  llmConfig,
  scraperSettings,
  captchaSolverConfig,
  OUTPUT_TYPES,
  DEFAULT_USER_AGENT,
  logger // Export logger if consumers might want to use the same instance
};
