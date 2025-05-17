// tools/process_url_list.js
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRootDir, '.env') });

import { scrapeUrl, OUTPUT_TYPES } from '../src/index.js';
import { logger } from '../src/utils/logger.js';
import { ScraperError, ConfigurationError } from '../src/utils/error-handler.js';

const URL_FILE_PATH = path.join(projectRootDir, 'urls_for_testing.txt');
const LOG_FILE_PATH = path.join(projectRootDir, 'tools_processing_log.txt');
const DELAY_MS = 2000;

async function appendToLogFile(message) {
  try {
    await fs.appendFile(LOG_FILE_PATH, `${new Date().toISOString()} - ${message}\n`);
  } catch (e) {
    console.error(`Failed to append to log file: ${e.message}`);
  }
}

async function processUrls() {
  let urlsToTest = [];
  try {
    const fileContent = await fs.readFile(URL_FILE_PATH, 'utf-8');
    urlsToTest = fileContent.split('\n').map(url => url.trim()).filter(url => url.length > 0);
  } catch (error) {
    logger.error(`Failed to read URL file: ${URL_FILE_PATH}. Error: ${error.message}`);
    urlsToTest = ["https://www.foreignaffairs.com/russia/putins-new-hermit-kingdom-closed-dictatorship"];
    logger.warn(`Using hardcoded fallback URL: ${urlsToTest[0]}`);
    await appendToLogFile(`ERROR_READING_URL_FILE: ${error.message}. Using fallback: ${urlsToTest[0]}`);
  }

  if (urlsToTest.length === 0) {
    logger.warn('No URLs to process.');
    await appendToLogFile('NO_URLS_TO_PROCESS');
    return;
  }

  logger.info(`Starting processing for ${urlsToTest.length} URLs.`);
  await appendToLogFile(`START_PROCESSING: ${urlsToTest.length} URLs`);

  let successCount = 0;
  let operationalFailureCount = 0;

  for (const url of urlsToTest) {
    logger.debug(`[DEBUG_MODE][processUrls] Processing URL from list: "${url}" (Type: ${typeof url}, Length: ${url?.length})`);
    if (url && typeof url === 'string') {
        const charCodes = Array.from(url).map(c => c.charCodeAt(0));
        logger.debug(`[DEBUG_MODE][processUrls] Character codes for current URL: [${charCodes.join(', ')}]`);
    }

    logger.info(`Processing URL: ${url}`);
    await appendToLogFile(`PROCESSING: ${url}`);

    try {
      const result = await scrapeUrl(url, { outputType: OUTPUT_TYPES.CONTENT_ONLY });

      if (result.success) {
        logger.info(`  STATUS: SUCCESS`);
        logger.info(`  METHOD: ${result.method}`);
        logger.info(`  XPATH: ${result.xpath || 'N/A'}`);
        await appendToLogFile(`SUCCESS: ${url} - Method: ${result.method}, XPath: ${result.xpath || 'N/A'}`);
        successCount++;
      } else {
        logger.error(`  STATUS: OPERATIONAL FAILURE`);
        logger.error(`  ERROR_TYPE: ${result.errorType}`);
        logger.error(`  ERROR_MESSAGE: ${result.error}`);
        if (result.details) logger.error(`  DETAILS: ${JSON.stringify(result.details)}`);
        await appendToLogFile(`OPERATIONAL_FAILURE: For ${url} - ${result.errorType}: ${result.error}`);
        operationalFailureCount++;
      }
    } catch (error) {
      // This catch block in the loop is for errors thrown by scrapeUrl that are NOT handled by returning a result object.
      // This should ideally only be for truly unexpected issues within scrapeUrl itself,
      // as ScraperErrors (including ConfigurationError from engine init) should be returned as result objects by scrapeUrl.
      // However, if scrapeUrl re-throws a critical error, it lands here.
      logger.error(`  STATUS: CRITICAL FAILURE (unhandled exception in processUrls for ${url})`);
      logger.error(`  ERROR_NAME: ${error.name}`);
      logger.error(`  ERROR_MESSAGE: ${error.message}`);
      if (error.details) logger.error(`  DETAILS: ${JSON.stringify(error.details)}`);
      if (error.stack) logger.error(`  STACK: ${error.stack}`);
      await appendToLogFile(`CRITICAL_ERROR_PROCESS_URLS: For ${url} - ${error.name}: ${error.message}`);
      operationalFailureCount++; // Still count as a failure for this URL

      // If it's a critical non-ScraperError, re-throw to be caught by the top-level IIFE catch, which will terminate the script.
      if (!(error instanceof ScraperError)) {
        logger.error(`[CRITICAL_INTERNAL_SCRIPT_ERROR_IN_LOOP] Uncaught non-ScraperError in processUrls loop for ${url}. Error:`, error);
        throw error; 
      }
    }

    if (urlsToTest.indexOf(url) < urlsToTest.length - 1) {
      logger.info(`Waiting for ${DELAY_MS / 1000} seconds before next URL...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  logger.info('--------------------------------------------------');
  logger.info('URL Processing Summary:');
  logger.info(`  Total URLs Processed: ${urlsToTest.length}`);
  logger.info(`  Successful Scrapes: ${successCount}`);
  logger.info(`  Operational Failures: ${operationalFailureCount}`);
  logger.info('--------------------------------------------------');
  await appendToLogFile(`END_PROCESSING_SUMMARY: Total=${urlsToTest.length}, Success=${successCount}, OpFail=${operationalFailureCount}`);
}

(async () => {
  try {
    await fs.writeFile(LOG_FILE_PATH, ''); 
    logger.info(`Log file initialized at: ${LOG_FILE_PATH}`);
    
    // The first call to scrapeUrl() inside processUrls will trigger engine initialization.
    // If that initialization fails (e.g., PuppeteerController constructor throws ConfigurationError),
    // scrapeUrl should catch it and return a failure object. If scrapeUrl itself has an unhandled
    // exception during init, it would be caught here.
    await processUrls();
    logger.info('All URLs processed or attempted.');
    process.exit(0); 
  } catch (e) {
    // This top-level catch is for:
    // 1. Truly critical errors during the initial setup of processUrls itself (e.g., file read for URLs if not handled).
    // 2. Non-ScraperErrors re-thrown from the processUrls loop, indicating a bug.
    // 3. ConfigurationErrors from engine initialization IF scrapeUrl failed to catch and return them as a result object.
    logger.error(`[CRITICAL_SCRIPT_FAILURE_TOP_LEVEL] Unhandled error: ${e.message}`);
    console.error("[CRITICAL_SCRIPT_FAILURE_TOP_LEVEL]", e); 
    await appendToLogFile(`CRITICAL_SCRIPT_FAILURE_TOP_LEVEL: ${e.name} - ${e.message}\n${e.stack}`);

    if (e instanceof ConfigurationError && e.details && e.details.reason && e.details.reason.includes('constructor')) {
        logger.error(`[CRITICAL_CONFIG_ERROR] Engine initialization failed: ${e.message}. This is a fatal error. Check configurations (e.g., scraper-settings.js for viewport).`);
    } else if (e instanceof ScraperError) {
        // This case should ideally not be hit if scrapeUrl correctly returns failure objects for ScraperErrors.
        logger.error("[OPERATIONAL_ERROR_ESCAPED_TOP_LEVEL] A ScraperError reached the top level unexpectedly. This indicates a flaw in scrapeUrl's error handling. Details:", e.details);
    } else {
        logger.error("[CRITICAL_INTERNAL_SCRIPT_ERROR_TOP_LEVEL] This was not a ScraperError. Exiting due to likely script bug.");
    }
    process.exit(1); 
  }
})();
