// tools/process_url_list.ts
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { logger } from '../src/utils/logger.js';
import { scrapeUrl, OUTPUT_TYPES, ScrapeResult } from '../src/index.js';
import { ConfigurationError, ScraperError } from '../src/utils/error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRootDir, '.env') });

const DELAY_MS = 5000;
const LOG_FILE_PATH = path.join(projectRootDir, 'tools_processing_log.txt');

// Get URL file path from command line argument
function getUrlFilePath(): string {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node dist/tools/process_url_list.js <url_file_path>');
    console.error('Example: node dist/tools/process_url_list.js urls_for_testing.txt');
    console.error('Example: node dist/tools/process_url_list.js /path/to/my_urls.txt');
    process.exit(1);
  }

  const urlFilePath = args[0];
  // If relative path, resolve from project root
  if (!path.isAbsolute(urlFilePath)) {
    return path.join(projectRootDir, urlFilePath);
  }
  return urlFilePath;
}

async function appendToLogFile(message: string): Promise<void> {
  try {
    await fs.appendFile(LOG_FILE_PATH, `${new Date().toISOString()} - ${message}\n`);
  } catch (e: any) {
    console.error(`Failed to append to log file: ${e.message}`);
  }
}

async function processUrls(urlFilePath: string): Promise<void> {
  let urlsToTest: string[] = ['https://www.example.com'];
  let successCount = 0;
  let operationalFailureCount = 0;

  try {
    const fileContent = await fs.readFile(urlFilePath, 'utf-8');
    urlsToTest = fileContent.split('\n').map(url => url.trim()).filter(url => url.length > 0);
  } catch (error: any) {
    logger.error(`Failed to read URL file: ${urlFilePath}. Error: ${error.message}`);
    await appendToLogFile(`ERROR_READING_URL_FILE: ${error.message}. Script will now exit.`);
    throw new ConfigurationError(`Failed to read URL file: ${urlFilePath}`, { originalError: error });
  }

  if (urlsToTest.length === 0) {
    logger.warn('No URLs to process. Exiting.');
    await appendToLogFile('NO_URLS_TO_PROCESS_EXITING');
    throw new ConfigurationError('No URLs found in the specified file to process.');
  }

  logger.info(`Starting processing for ${urlsToTest.length} URLs.`);
  await appendToLogFile(`START_PROCESSING: ${urlsToTest.length} URLs`);

  for (const url of urlsToTest) {
    if (logger.isDebugging()) {
        logger.debug(`[DEBUG_MODE][processUrls] Processing URL from list: "${url}" (Type: ${typeof url}, Length: ${url?.length})`);
        if (url && typeof url === 'string') {
            const charCodes = Array.from(url).map(c => c.charCodeAt(0));
            logger.debug(`[DEBUG_MODE][processUrls] Character codes for current URL: [${charCodes.join(', ')}]`);
        }
    }

    logger.info(`Processing URL: ${url}`);
    await appendToLogFile(`PROCESSING: ${url}`);

    let result: ScrapeResult;
    try {
        logger.info(`[DEBUG] About to call scrapeUrl for: ${url}`);
        const startTime = Date.now();

        // Add timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Scrape operation timed out after 120 seconds')), 120000);
        });

        const scrapePromise = scrapeUrl(url, { outputType: OUTPUT_TYPES.CONTENT_ONLY as any });

        result = await Promise.race([scrapePromise, timeoutPromise]) as ScrapeResult;

        const endTime = Date.now();
        logger.info(`[DEBUG] scrapeUrl completed in ${endTime - startTime}ms`);
    } catch (error: any) {
        logger.error(`  STATUS: CRITICAL FAILURE (unhandled exception from scrapeUrl for ${url})`);
        logger.error(`  ERROR_NAME: ${error.name}`);
        logger.error(`  ERROR_MESSAGE: ${error.message}`);
        if (error.details) logger.error(`  DETAILS: ${JSON.stringify(error.details)}`);
        if (error.stack) logger.error(`  STACK: ${error.stack}`);
        await appendToLogFile(`CRITICAL_ERROR_SCRAPEURL_CALL: For ${url} - ${error.name}: ${error.message}`);
        throw error; 
    }

    if (result.success) {
      successCount++;
      logger.info(`  STATUS: SUCCESS`);
      logger.info(`  METHOD: ${result.method}`);
      logger.info(`  XPATH: ${result.xpath || 'N/A'}`);
      await appendToLogFile(`SUCCESS: ${url} - Method: ${result.method}, XPath: ${result.xpath || 'N/A'}`);
    } else {
      operationalFailureCount++;
      logger.error(`  STATUS: OPERATIONAL FAILURE (FORCING SCRIPT EXIT)`);
      logger.error(`  URL: ${url}`);
      logger.error(`  ERROR_TYPE: ${result.errorType}`);
      logger.error(`  ERROR_MESSAGE: ${result.error}`);
      if (result.details) logger.error(`  DETAILS: ${JSON.stringify(result.details)}`);
      await appendToLogFile(`OPERATIONAL_FAILURE_EXITING: For ${url} - ${result.errorType}: ${result.error}`);
      throw new Error(`Operational failure for URL ${url}: ${result.errorType} - ${result.error}`);
    }

    if (urlsToTest.indexOf(url) < urlsToTest.length - 1) {
      logger.info('=================================================='); // Added separator
      logger.info(`Waiting for ${DELAY_MS / 1000} seconds before next URL...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  logger.info('--------------------------------------------------');
  logger.info('URL Processing Summary (ALL SUCCESSFUL):');
  logger.info(`  Total URLs Processed: ${urlsToTest.length}`);
  logger.info(`  Successful Scrapes: ${successCount}`);
  logger.info(`  Operational Failures: ${operationalFailureCount}`); 
  logger.info('--------------------------------------------------');
  await appendToLogFile(`END_PROCESSING_ALL_SUCCESS: Total=${urlsToTest.length}, Success=${successCount}`);
}

(async () => {
  try {
    const urlFilePath = getUrlFilePath();
    logger.info(`Using URL file: ${urlFilePath}`);

    await fs.writeFile(LOG_FILE_PATH, '');
    logger.info(`Log file initialized at: ${LOG_FILE_PATH}`);
    await processUrls(urlFilePath);
    logger.info('All URLs processed successfully.');
    process.exit(0);
  } catch (e: any) {
    logger.error(`[CRITICAL_SCRIPT_FAILURE_OR_OPERATIONAL_HALT] Script halted: ${e.message}`);
    console.error("[CRITICAL_SCRIPT_FAILURE_OR_OPERATIONAL_HALT]", e); 
    await appendToLogFile(`SCRIPT_HALTED: ${e.name} - ${e.message}\n${e.stack}`);

    if (e instanceof ConfigurationError) {
        logger.error(`[CONFIG_ERROR_HALT] Configuration error: ${e.message}.`);
        if (e.details && e.details.reason && (e.details.reason as string).includes('constructor')) {
            logger.error(`[CONFIG_ERROR_HALT] Engine initialization failed: ${e.message}.`);
        }
    } else if (e instanceof ScraperError) {
        logger.error("[OPERATIONAL_ERROR_HALT] A ScraperError caused script halt. Details:", e.details);
    } else {
        logger.error("[SCRIPT_LOGIC_OR_OPERATIONAL_HALT] Script halted due to error:", e.message);
    }
    process.exit(1);
  }
})();
