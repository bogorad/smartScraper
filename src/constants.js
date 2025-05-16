// src/constants.js

/**
 * Defines the scraping methods the system can use.
 * These values are stored in the KnownSitesTable.
 */
export const METHODS = Object.freeze({
    CURL: 'curl',
    PUPPETEER_STEALTH: 'puppeteer_stealth',
    PUPPETEER_CAPTCHA: 'puppeteer_captcha', // Implies stealth + CAPTCHA solving
});

/**
 * Defines the types of output the scraper can produce.
 */
export const OUTPUT_TYPES = Object.freeze({
    CONTENT_ONLY: 'content', // Only the extracted content from the main XPath
    FULL_HTML: 'full_html',  // The entire HTML of the page
});

/**
 * Default User-Agent string if no other is specified.
 * It's good practice to use a common, current browser User-Agent.
 * This can be overridden by scraper settings or per-request.
 */
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36';
// Periodically update this to a recent common User-Agent.

/**
 * Maximum number of characters for HTML content summary sent to LLM.
 * Helps manage token usage and request size.
 */
export const LLM_HTML_SUMMARY_MAX_LENGTH = 15000;

/**
 * Maximum number of text snippets to extract for LLM context.
 */
export const LLM_MAX_SNIPPETS = 10;

/**
 * Maximum length of each text snippet for LLM context.
 */
export const LLM_SNIPPET_MAX_LENGTH = 200;


/**
 * Default path for the known sites storage file, relative to the project root.
 * This can be overridden by scraper settings.
 */
export const DEFAULT_KNOWN_SITES_STORAGE_PATH = './data/known_sites_storage.json';

/**
 * Default path for saving HTML of failed scrapes, relative to the project root.
 * This can be overridden by scraper settings.
 */
export const DEFAULT_FAILED_HTML_DUMPS_PATH = './failed_html_dumps';


// Add any other application-wide constants here.
// For example, if you have specific status codes or event names used internally.

// Example: Internal status indicators (if needed beyond simple success/failure)
// export const SCRAPE_STATUS = Object.freeze({
//     SUCCESS: 'success',
//     FAILURE_NETWORK: 'failure_network',
//     FAILURE_CAPTCHA: 'failure_captcha',
//     FAILURE_XPATH_DISCOVERY: 'failure_xpath_discovery',
//     FAILURE_EXTRACTION: 'failure_extraction',
//     PENDING: 'pending',
// });

// Ensure all exported constants are immutable if they are objects/arrays
// Object.freeze helps prevent accidental modification.
