// src/constants.js

/**
 * Defines the scraping methods the system can use.
 * These values are stored in the KnownSitesTable.
 */
export const METHODS = Object.freeze({
  CURL: 'curl',
  PUPPETEER_STEALTH: 'puppeteer_stealth', // Implies stealth plugins
  PUPPETEER_CAPTCHA: 'puppeteer_captcha', // Implies stealth + CAPTCHA solving
});

/**
 * Defines the types of output the scraper can produce.
 */
export const OUTPUT_TYPES = Object.freeze({
  CONTENT_ONLY: 'content', // Only the extracted content from the main XPath
  FULL_HTML: 'full_html',  // The entire HTML of the page
  // MARKDOWN: 'markdown', // Future: Convert extracted content to Markdown
});

/**
 * Default User-Agent string if no other is specified.
 * It's good practice to use a common, current browser User-Agent.
 * This can be overridden by scraper settings or per-request.
 */
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
// Periodically update this to a recent common User-Agent.

// Add any other application-wide constants here.
// For example, if you have specific status codes or event names used internally.

// Ensure all exported constants are immutable if they are objects/arrays
// Object.freeze helps prevent accidental modification.
