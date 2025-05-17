// src/index.js
import dotenv from 'dotenv';
dotenv.config(); 

import { CoreScraperEngine } from './core/engine.js';
import { logger } from './utils/logger.js';
import { isValidUrl } from './utils/url-helpers.js'; // normalizeDomain not used here directly
import { OUTPUT_TYPES, DEFAULT_USER_AGENT } from './constants.js';
import {
  llmConfig,
  scraperSettings,
  captchaSolverConfig
} from '../config/index.js'; 
import { ConfigurationError, ScraperError } from './utils/error-handler.js';

let defaultEngineInstance = null;

function getDefaultEngine() {
  if (!defaultEngineInstance) {
    defaultEngineInstance = new CoreScraperEngine({
      scraperSettings, 
      llmConfig,       
      captchaSolverConfig 
    });
  }
  return defaultEngineInstance;
}

async function scrapeUrl(url, options = {}) {
  const {
    proxyDetails = null,
    userAgentString = null,
    outputType = OUTPUT_TYPES.CONTENT_ONLY,
  } = options;

  if (!isValidUrl(url)) {
    const errorMsg = `Invalid URL format provided: ${url}`;
    logger.error(errorMsg);
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
    return result; 
  } catch (error) {
    if (error instanceof ScraperError) {
      logger.error(`${error.name} during scrapeUrl for ${url}: ${error.message}`, error.details);
      return {
        success: false,
        data: null,
        error: error.message,
        message: error.message, 
        details: error.details,
        errorType: error.name.replace('Error', '').toLowerCase(),
        htmlContent: error.details?.htmlContent || null
      };
    }
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

export {
  CoreScraperEngine,
  scrapeUrl,
  llmConfig,
  scraperSettings,
  captchaSolverConfig,
  OUTPUT_TYPES,
  DEFAULT_USER_AGENT,
  logger 
};
