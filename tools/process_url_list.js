// tools/process_url_list.js
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables from .env file at the project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRootDir = path.resolve(__dirname, '..'); // Assumes tools/ is one level down from root
dotenv.config({ path: path.join(projectRootDir, '.env') });

// Import from the main codebase
import { scrapeUrl } from '../src/index.js'; // Adjust path if script is elsewhere
import { logger } from '../src/utils/logger.js';
import { OUTPUT_TYPES } from '../src/constants.js';

const URL_FILE_PATH = path.join(projectRootDir, 'urls_for_testing.txt');
const LOG_FILE_PATH = path.join(projectRootDir, 'tools_processing_log.txt'); // For detailed logging

async function appendToLogFile(message) {
  try {
    await fs.appendFile(LOG_FILE_PATH, `${new Date().toISOString()} - ${message}\n`);
  } catch (error) {
    console.error(`Failed to write to log file: ${error.message}`);
  }
}

async function processUrls() {
  logger.info(`Starting URL processing. Reading URLs from: ${URL_FILE_PATH}`);
  await appendToLogFile(`--- Session Start: URL Processing ---`);

  let urlsToTest = [];
  try {
    const fileContent = await fs.readFile(URL_FILE_PATH, 'utf-8');
    urlsToTest = fileContent
      .split('\n')
      .map(url => url.trim())
      .filter(url => url && !url.startsWith('#')); // Filter out empty lines and comments
  } catch (error) {
    logger.error(`Failed to read URL file at ${URL_FILE_PATH}: ${error.message}`);
    await appendToLogFile(`ERROR: Failed to read URL file: ${error.message}`);
    return;
  }

  if (urlsToTest.length === 0) {
    logger.info('No URLs found in the file to process.');
    await appendToLogFile('INFO: No URLs found to process.');
    return;
  }

  logger.info(`Found ${urlsToTest.length} URLs to process.`);
  await appendToLogFile(`INFO: Found ${urlsToTest.length} URLs to process.`);

  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < urlsToTest.length; i++) {
    const url = urlsToTest[i];
    logger.info(`\n[${i + 1}/${urlsToTest.length}] Processing URL: ${url}`);
    await appendToLogFile(`\nINFO: [${i + 1}/${urlsToTest.length}] Processing URL: ${url}`);
    await appendToLogFile(`INFO: --------------------------------------------------`);
    await appendToLogFile(`INFO: URL: ${url}`);

    try {
      // Using the main public API of the scraper
      // We request CONTENT_ONLY to get the main extracted data along with method and xpath
      const result = await scrapeUrl(url, { outputType: OUTPUT_TYPES.CONTENT_ONLY });

      if (result.success) {
        successCount++;
        logger.info(`  STATUS: SUCCESS`);
        logger.info(`  METHOD_USED: ${result.method || 'N/A'}`);
        logger.info(`  XPATH_FOUND: ${result.xpath || 'N/A'}`);
        const contentSnippet = result.data ? result.data.substring(0, 150).replace(/\s+/g, ' ') + '...' : 'No data';
        logger.info(`  CONTENT_SNIPPET: ${contentSnippet}`);

        await appendToLogFile(`INFO: STATUS: SUCCESS`);
        await appendToLogFile(`INFO: METHOD_USED: ${result.method || 'N/A'}`);
        await appendToLogFile(`INFO: XPATH_FOUND: ${result.xpath || 'N/A'}`);
        await appendToLogFile(`INFO: CONTENT_SNIPPET: ${contentSnippet}`);
      } else {
        // scrapeUrl is designed to return a specific structure on failure if it catches the error itself
        failureCount++;
        logger.warn(`  STATUS: FAILURE (handled by scrapeUrl)`);
        logger.warn(`  ERROR: ${result.error || 'Unknown error from scrapeUrl'}`);
        if (result.errorDetails) logger.warn(`  DETAILS: ${JSON.stringify(result.errorDetails)}`);

        await appendToLogFile(`WARN: STATUS: FAILURE (handled by scrapeUrl)`);
        await appendToLogFile(`WARN: ERROR: ${result.error || 'Unknown error from scrapeUrl'}`);
        if (result.errorDetails) await appendToLogFile(`WARN: DETAILS: ${JSON.stringify(result.errorDetails)}`);
      }
    } catch (error) {
      // Catch errors not handled by scrapeUrl's internal try/catch (e.g., config errors before scrape starts)
      failureCount++;
      logger.error(`  STATUS: FAILURE (exception caught)`);
      logger.error(`  ERROR_NAME: ${error.name}`);
      logger.error(`  ERROR_MESSAGE: ${error.message}`);
      if (error.details) logger.error(`  DETAILS: ${JSON.stringify(error.details)}`);
      // logger.debug(error.stack); // Optionally log full stack for deeper debug

      await appendToLogFile(`ERROR: STATUS: FAILURE (exception caught)`);
      await appendToLogFile(`ERROR: ERROR_NAME: ${error.name}`);
      await appendToLogFile(`ERROR: ERROR_MESSAGE: ${error.message}`);
      if (error.details) await appendToLogFile(`ERROR: DETAILS: ${JSON.stringify(error.details)}`);
    } finally {
      await appendToLogFile(`INFO: --------------------------------------------------`);
      // Optional: Add a small delay between requests if hitting many sites rapidly
      if (i < urlsToTest.length - 1) {
        // const delayMs = 1000; // 1 second delay
        // logger.debug(`Waiting ${delayMs / 1000}s before next URL...`);
        // await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  logger.info(`\n--- Processing Complete ---`);
  logger.info(`Total URLs Processed: ${urlsToTest.length}`);
  logger.info(`Successful Scrapes: ${successCount}`);
  logger.info(`Failed Scrapes: ${failureCount}`);
  logger.info(`Detailed log written to: ${LOG_FILE_PATH}`);

  await appendToLogFile(`\n--- Session End ---`);
  await appendToLogFile(`INFO: Total URLs Processed: ${urlsToTest.length}`);
  await appendToLogFile(`INFO: Successful Scrapes: ${successCount}`);
  await appendToLogFile(`INFO: Failed Scrapes: ${failureCount}`);
}

// Ensure .env is loaded and then run the processing
// This top-level await is available in ES modules
try {
  await fs.writeFile(LOG_FILE_PATH, ''); // Clear/create log file at start
  logger.info(`Log file initialized at: ${LOG_FILE_PATH}`);
  await processUrls();
} catch (e) {
  logger.error(`Critical error during script execution: ${e.message}`);
  console.error(e); // Also log to console for immediate visibility
  appendToLogFile(`CRITICAL_ERROR: ${e.message}\n${e.stack}`);
}
