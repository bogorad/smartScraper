// src/index.js

// Load environment variables (if using .env file)
// This should be one of the first things to run if your configs depend on .env
import dotenv from 'dotenv';
dotenv.config(); // Loads .env file from project root

// Import core components and configurations
import { CoreScraperEngine } from './core/engine.js';
import {
    llmConfig as defaultLlmConfig,
    scraperSettings as defaultScraperSettings,
    captchaSolverConfig as defaultCaptchaSolverConfig
} from '../config/index.js'; // Default configurations
import { logger } from './utils/logger.js';
import { isValidUrl } from './utils/url-helpers.js';
import { OUTPUT_TYPES } from './constants.js';
import {
    ScraperError,
    ConfigurationError
} from './utils/error-handler.js';

// Store a single instance of the engine if desired, or allow creating multiple
let defaultEngineInstance = null;

function getDefaultEngine() {
    if (!defaultEngineInstance) {
        // Initialize with default configurations loaded from config/index.js
        // These configs would have already picked up .env values if dotenv.config() was called.
        defaultEngineInstance = new CoreScraperEngine({
            scraperSettings: defaultScraperSettings,
            llmConfig: defaultLlmConfig,
            captchaSolverConfig: defaultCaptchaSolverConfig,
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
 * @param {object|null} [options.proxyDetails=null] - Proxy configuration.
 *        Example: { server: 'http://user:pass@proxy.example.com:8080' }
 * @param {string|null} [options.userAgentString=null] - Custom User-Agent string.
 * @param {string} [options.outputType='content'] - Desired output type ('content' or 'full_html').
 *                                                  See OUTPUT_TYPES in constants.js.
 * @returns {Promise<{success: boolean, data: string|null, error: string|null, method?: string, xpath?: string}>}
 *          The result of the scraping attempt.
 */
async function scrapeUrl(url, options = {}) {
    if (!isValidUrl(url)) {
        const errorMsg = `Invalid URL provided: ${url}`;
        logger.error(errorMsg);
        throw new ConfigurationError('Invalid URL format', { url });
    }

    const {
        proxyDetails = null,
        userAgentString = null,
        outputType = OUTPUT_TYPES.CONTENT_ONLY,
    } = options;

    if (!Object.values(OUTPUT_TYPES).includes(outputType)) {
        const errorMsg = `Invalid outputType specified: ${outputType}. Valid types are: ${Object.values(OUTPUT_TYPES).join(', ')}`;
        logger.error(errorMsg);
        throw new ConfigurationError('Invalid output type', {
            outputType,
            validTypes: Object.values(OUTPUT_TYPES)
        });
    }

    try {
        const engine = getDefaultEngine();
        const result = await engine.scrape(url, proxyDetails, userAgentString, outputType);
        return result;
    } catch (error) {
        // Handle different types of errors
        if (error instanceof ScraperError) {
            logger.error(`${error.name} during scrapeUrl for ${url}: ${error.message}`, error.details);

            // Create a structured error response with appropriate details
            const errorResponse = {
                success: false,
                data: null,
                error: error.message,
                errorType: error.name.replace('Error', '').toLowerCase(),
                errorDetails: error.details
            };

            return errorResponse;
        } else {
            // For unexpected errors
            logger.error(`Unhandled error during scrapeUrl for ${url}: ${error.message}`, error.stack);
            return {
                success: false,
                data: null,
                error: `Unhandled scraper error: ${error.message}`,
                errorType: 'unknown'
            };
        }
    }
}

// Export the main engine class for advanced usage and the convenience function.
export {
    CoreScraperEngine,
    scrapeUrl,
    // Optionally re-export configurations if consumers might need them directly
    // though it's often better for them to manage their own if they instantiate CoreScraperEngine
    defaultLlmConfig,
    defaultScraperSettings,
    defaultCaptchaSolverConfig,
    logger // Export logger if consumers might want to use the same instance
};

// Example of how this library might be used by another project:
/*
    import { scrapeUrl, CoreScraperEngine, defaultScraperSettings } from 'universal-scraper-library'; // Assuming published as a package

    async function main() {
        const result1 = await scrapeUrl('https://example.com/article/123');
        if (result1.success) {
            console.log('Extracted Content:', result1.data);
        } else {
            console.error('Scrape failed:', result1.error);
        }

        // For more control:
        const customSettings = { ...defaultScraperSettings, maxLlmRetries: 1 };
        const myEngine = new CoreScraperEngine({ scraperSettings: customSettings });
        const result2 = await myEngine.scrape('https://anotherexample.com', null, null, 'full_html');
        // ...
    }

    main();
*/
