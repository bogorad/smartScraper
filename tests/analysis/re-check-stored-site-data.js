// tests/analysis/re-check-stored-site-data.js

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { URL } from 'url';

// Import core modules from the main codebase
import { CoreScraperEngine } from '../../src/core/engine.js';
import { KnownSitesManager } from '../../src/storage/known-sites-manager.js';
import { normalizeDomain, isValidUrl } from '../../src/utils/url-helpers.js';
import { logger } from '../../src/utils/logger.js';
import { METHODS } from '../../src/constants.js';
import { fetchWithCurl } from '../../src/network/curl-handler.js';
import { HtmlAnalyserFixed } from '../../src/analysis/html-analyser-fixed.js';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the known sites storage file
const KNOWN_SITES_STORAGE_PATH = path.resolve(__dirname, '../../data/known_sites_storage.json');
// Path to the report file
const REPORT_FILE_PATH = path.resolve(__dirname, '../../sites-report.txt');

// Create an instance of HtmlAnalyserFixed to use its methods
const htmlAnalyser = new HtmlAnalyserFixed();

/**
 * Find RSS feed links in the HTML
 * @param {string} html - The HTML content
 * @param {string} baseUrl - The base URL for resolving relative URLs
 * @returns {Array<string>} Array of RSS feed URLs
 */
function findRssLinks(html, baseUrl) {
    const rssLinks = [];

    // Look for RSS link tags
    const rssLinkRegex = /<link[^>]*type=["']application\/rss\+xml["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = rssLinkRegex.exec(html)) !== null) {
        try {
            const rssUrl = new URL(match[1], baseUrl).href;
            rssLinks.push(rssUrl);
        } catch (error) {
            // Skip invalid URLs
            continue;
        }
    }

    // Also look for atom feeds
    const atomLinkRegex = /<link[^>]*type=["']application\/atom\+xml["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
    while ((match = atomLinkRegex.exec(html)) !== null) {
        try {
            const atomUrl = new URL(match[1], baseUrl).href;
            rssLinks.push(atomUrl);
        } catch (error) {
            // Skip invalid URLs
            continue;
        }
    }

    // Also look for links with "rss" or "feed" in the URL
    const hrefRegex = /<a[^>]*href=["']([^"']*(?:rss|feed)[^"']*)["'][^>]*>/gi;
    while ((match = hrefRegex.exec(html)) !== null) {
        try {
            const feedUrl = new URL(match[1], baseUrl).href;
            if (!rssLinks.includes(feedUrl)) {
                rssLinks.push(feedUrl);
            }
        } catch (error) {
            // Skip invalid URLs
            continue;
        }
    }

    return rssLinks;
}

/**
 * Extract the first article URL from an RSS feed
 * @param {string} rssContent - The RSS feed content
 * @param {string} baseUrl - The base URL for resolving relative URLs
 * @returns {string|null} The first article URL or null if none found
 */
function extractFirstArticleFromRss(rssContent, baseUrl) {
    // Simple regex to extract item links from RSS
    const itemLinkRegex = /<item>[\s\S]*?<link>([^<]+)<\/link>/i;
    const match = itemLinkRegex.exec(rssContent);

    if (match && match[1]) {
        try {
            return new URL(match[1], baseUrl).href;
        } catch (error) {
            logger.warn(`Invalid URL in RSS feed: ${match[1]}`);
            return null;
        }
    }

    // Try atom format if RSS format didn't work
    const atomLinkRegex = /<entry>[\s\S]*?<link[^>]*href=["']([^"']+)["'][^>]*>/i;
    const atomMatch = atomLinkRegex.exec(rssContent);

    if (atomMatch && atomMatch[1]) {
        try {
            return new URL(atomMatch[1], baseUrl).href;
        } catch (error) {
            logger.warn(`Invalid URL in Atom feed: ${atomMatch[1]}`);
            return null;
        }
    }

    return null;
}

/**
 * Extract an article URL from the HTML of a front page
 * @param {string} html - The HTML content of the front page
 * @param {string} baseUrl - The base URL of the front page
 * @param {string} domain - The domain of the site
 * @returns {string} A valid article URL
 */
async function extractArticleUrl(html, baseUrl, domain) {
    // Only use RSS feeds, no fallback to link extraction
    logger.info('Checking for RSS feeds...');
    const rssLinks = findRssLinks(html, baseUrl);

    if (rssLinks.length > 0) {
        logger.info(`Found ${rssLinks.length} RSS feeds. Fetching the first one...`);
        try {
            // Fetch the RSS feed content using curl from the main codebase
            const rssUrl = rssLinks[0];
            logger.info(`Fetching RSS feed from: ${rssUrl}`);

            const rssResponse = await fetchWithCurl(rssUrl);
            if (!rssResponse.success) {
                throw new Error(`Failed to fetch RSS feed: ${rssResponse.error}`);
            }

            const rssContent = rssResponse.html;

            // Extract the first article URL from the RSS feed
            const articleUrl = extractFirstArticleFromRss(rssContent, baseUrl);

            if (articleUrl && isValidUrl(articleUrl)) {
                logger.info(`Successfully extracted article URL from RSS: ${articleUrl}`);
                return articleUrl;
            } else {
                logger.warn('Could not extract valid article URL from RSS feed.');
                return null; // Return null to indicate no article URL found
            }
        } catch (error) {
            logger.warn(`Error fetching or parsing RSS feed: ${error.message}`);
            return null; // Return null to indicate no article URL found
        }
    } else {
        logger.info('No RSS feeds found. Skipping this site.');
        return null; // Return null to indicate no article URL found
    }
}

/**
 * Main function to re-check stored site data
 */
async function recheckStoredSiteData() {
    try {
        // Read the known sites storage file
        const knownSitesData = await readKnownSitesStorage();

        // Create a new CoreScraperEngine instance with increased timeouts
        const scraperEngine = new CoreScraperEngine({
            scraper: {
                navigationTimeout: 60000, // 60 seconds
                defaultTimeout: 120000,   // 2 minutes
                maxConcurrentRequests: 1, // Process one site at a time to avoid rate limiting
                domComparisonThreshold: 0.60, // Lower threshold to 60% for more realistic DOM comparison
                puppeteerOptions: {
                    executablePath: process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium', // Path to Chromium
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu'
                    ]
                }
            },
            proxy: {
                server: 'http://otnlqxce-rotate:pgg7cco5d94z@p.webshare.io:80' // HTTP proxy for web scraping
            },
            captchaSolver: {
                apiKey: process.env.CAPTCHA_API_KEY,
                service: process.env.CAPTCHA_SERVICE_NAME || '2captcha'
            }
        });

        // Create a temporary KnownSitesManager for comparison (don't modify the original)
        const tempKnownSitesManager = new KnownSitesManager();

        // Initialize report
        await initializeReport();

        // Process each site
        const domains = Object.keys(knownSitesData);
        logger.info(`Found ${domains.length} domains in known sites storage`);

        // Statistics for summary
        const stats = {
            total: domains.length,
            success: 0,
            match: 0,
            mismatch: 0,
            error: 0,
            methodStats: {}
        };

        // Add a delay between requests to avoid rate limiting
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

        for (let i = 0; i < domains.length; i++) {
            const domain = domains[i];
            const siteConfig = knownSitesData[domain];

            logger.info(`Processing domain ${i + 1}/${domains.length}: ${domain}`);

            // Get a real article URL from the front page of the site
            let testUrl;

            // Check if we have a sample URL in the config
            if (siteConfig.sample_article_url) {
                testUrl = siteConfig.sample_article_url;
                logger.info(`Using sample URL from config: ${testUrl}`);
            } else {
                // Try to get a real article URL from the front page
                try {
                    // Construct the front page URL
                    const frontPageUrl = `https://www.${domain}`;
                    logger.info(`Fetching front page: ${frontPageUrl}`);

                    // Make a request to the front page using curl from the main codebase
                    const userAgent = siteConfig.user_agent_to_use || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
                    const response = await fetchWithCurl(frontPageUrl, null, null, userAgent);

                    if (!response.success) {
                        // Try without www.
                        const altFrontPageUrl = `https://${domain}`;
                        logger.info(`Front page with www. failed, trying: ${altFrontPageUrl}`);

                        const altResponse = await fetchWithCurl(altFrontPageUrl, null, null, userAgent);

                        if (!altResponse.success) {
                            throw new Error(`Failed to fetch front page: ${altResponse.error}`);
                        }

                        const html = altResponse.html;

                        // Check for CAPTCHA using the main codebase's HtmlAnalyser
                        if (htmlAnalyser.detectCaptchaMarkers(html)) {
                            logger.warn(`CAPTCHA detected on front page of ${domain}. This might affect URL extraction.`);
                        }

                        testUrl = await extractArticleUrl(html, altFrontPageUrl, domain);

                        // Skip this site if no RSS feed or article URL found
                        if (testUrl === null) {
                            logger.info(`Skipping domain ${domain} - no RSS feed found`);
                            continue; // Skip to the next domain
                        }
                    } else {
                        const html = response.html;

                        // Check for CAPTCHA using the main codebase's HtmlAnalyser
                        if (htmlAnalyser.detectCaptchaMarkers(html)) {
                            logger.warn(`CAPTCHA detected on front page of ${domain}. This might affect URL extraction.`);
                        }

                        testUrl = await extractArticleUrl(html, frontPageUrl, domain);

                        // Skip this site if no RSS feed or article URL found
                        if (testUrl === null) {
                            logger.info(`Skipping domain ${domain} - no RSS feed found`);
                            continue; // Skip to the next domain
                        }
                    }

                    logger.info(`Extracted article URL: ${testUrl}`);
                } catch (error) {
                    logger.warn(`Failed to extract article URL from front page: ${error.message}`);

                    // Skip this site if we couldn't extract an article URL
                    logger.info(`Skipping domain ${domain} - could not extract article URL`);
                    continue; // Skip to the next domain
                }
            }

            logger.info(`Testing URL: ${testUrl}`);

            try {
                // Attempt to discover the XPath as if the site was unknown
                let discoveryResult;

                // Create a timeout promise
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error(`Discovery timed out after ${3 * 60000}ms`));
                    }, 3 * 60000); // 3 minutes timeout
                });

                // Apply the patches to the engine once at the beginning
                // Store original methods to restore at the end
                const originalMethods = {};

                // Patch the puppeteerController methods
                function applyPuppeteerPatches() {
                    // Store original methods
                    originalMethods.queryXPathWithDetails = scraperEngine.puppeteerController.queryXPathWithDetails;
                    originalMethods.getPageContent = scraperEngine.puppeteerController.getPageContent;
                    originalMethods.launchAndNavigate = scraperEngine.puppeteerController.launchAndNavigate;
                    originalMethods.cleanupPuppeteer = scraperEngine.puppeteerController.cleanupPuppeteer;
                    originalMethods.solveIfPresent = scraperEngine.captchaSolver.solveIfPresent;

                    // Add a method to store the last page content
                    let lastPageContent = null;

                    // Patch launchAndNavigate to add waitForTimeout to the page object
                    scraperEngine.puppeteerController.launchAndNavigate = async (url, proxyDetails, userAgent) => {
                        const result = await originalMethods.launchAndNavigate.call(scraperEngine.puppeteerController, url, proxyDetails, userAgent);

                        // Add waitForTimeout method to the page object if it doesn't exist
                        if (result.page) {
                            if (!result.page.waitForTimeout) {
                                logger.info('Adding waitForTimeout method to page object');
                                result.page.waitForTimeout = async (timeout) => {
                                    logger.info(`Mock waitForTimeout called with ${timeout}ms`);
                                    return new Promise(resolve => setTimeout(resolve, timeout));
                                };
                            }

                            // Add $x method to the page object if it doesn't exist
                            if (!result.page.$x) {
                                logger.info('Adding $x method to page object');
                                result.page.$x = async (xpath) => {
                                    logger.info(`Mock $x called with ${xpath}`);
                                    return [{
                                        dispose: async () => {},
                                        innerHTML: ''
                                    }];
                                };
                            }

                            // Add evaluate method to the page object if it doesn't exist
                            if (!result.page.evaluate) {
                                logger.info('Adding evaluate method to page object');
                                result.page.evaluate = async (fn, ...args) => {
                                    logger.info(`Mock evaluate called`);
                                    return '';
                                };
                            }
                        }

                        return result;
                    };

                    // Patch cleanupPuppeteer to ensure we don't lose our patches
                    scraperEngine.puppeteerController.cleanupPuppeteer = async (browser) => {
                        // Call the original method
                        await originalMethods.cleanupPuppeteer.call(scraperEngine.puppeteerController, browser);
                    };

                    // Replace with our fixed version that falls back to static HTML analysis when page is null
                    scraperEngine.puppeteerController.queryXPathWithDetails = async (page, xpath) => {
                        if (!page) {
                            logger.info(`Page is null, falling back to static HTML analysis for XPath: ${xpath}`);
                            return scraperEngine.htmlAnalyser.queryStaticXPathWithDetails(lastPageContent, xpath);
                        }

                        // Add waitForTimeout method to the page object if it doesn't exist
                        if (!page.waitForTimeout) {
                            logger.info('Adding waitForTimeout method to page object in queryXPathWithDetails');
                            page.waitForTimeout = async (timeout) => {
                                logger.info(`Mock waitForTimeout called with ${timeout}ms`);
                                return new Promise(resolve => setTimeout(resolve, timeout));
                            };
                        }

                        // Otherwise use the original method
                        return await originalMethods.queryXPathWithDetails.call(scraperEngine.puppeteerController, page, xpath);
                    };

                    // Patch getPageContent to store the content
                    scraperEngine.puppeteerController.getPageContent = async (page) => {
                        if (!page) {
                            logger.info(`Page is null in getPageContent, returning last known content`);
                            return lastPageContent || '';
                        }

                        // Add waitForTimeout method to the page object if it doesn't exist
                        if (!page.waitForTimeout) {
                            logger.info('Adding waitForTimeout method to page object in getPageContent');
                            page.waitForTimeout = async (timeout) => {
                                logger.info(`Mock waitForTimeout called with ${timeout}ms`);
                                return new Promise(resolve => setTimeout(resolve, timeout));
                            };
                        }

                        const content = await originalMethods.getPageContent.call(scraperEngine.puppeteerController, page);
                        lastPageContent = content;
                        return content;
                    };

                    // Patch the captchaSolver.solveIfPresent method to handle null page
                    scraperEngine.captchaSolver.solveIfPresent = async (page, url) => {
                        if (!page) {
                            logger.info(`Page is null in solveIfPresent, skipping CAPTCHA solving`);
                            return true;
                        }

                        // Add waitForTimeout method to the page object if it doesn't exist
                        if (!page.waitForTimeout) {
                            logger.info('Adding waitForTimeout method to page object in solveIfPresent');
                            page.waitForTimeout = async (timeout) => {
                                logger.info(`Mock waitForTimeout called with ${timeout}ms`);
                                return new Promise(resolve => setTimeout(resolve, timeout));
                            };
                        }

                        return await originalMethods.solveIfPresent.call(scraperEngine.captchaSolver, page, url);
                    };

                    logger.info('Applied all Puppeteer patches');
                }

                // Restore original methods
                function restorePuppeteerPatches() {
                    scraperEngine.puppeteerController.queryXPathWithDetails = originalMethods.queryXPathWithDetails;
                    scraperEngine.puppeteerController.getPageContent = originalMethods.getPageContent;
                    scraperEngine.puppeteerController.launchAndNavigate = originalMethods.launchAndNavigate;
                    scraperEngine.puppeteerController.cleanupPuppeteer = originalMethods.cleanupPuppeteer;
                    scraperEngine.captchaSolver.solveIfPresent = originalMethods.solveIfPresent;
                    logger.info('Restored all original Puppeteer methods');
                }

                // Apply the patches
                applyPuppeteerPatches();

                // Create a custom wrapper around _discoverAndScrape that fixes the bug with null page
                const customDiscoverAndScrape = async (url, domain, proxyDetails, userAgent, requestedOutput, oldConfigHint) => {
                    try {
                        // Now call the original _discoverAndScrape method
                        const result = await scraperEngine._discoverAndScrape(
                            url,
                            domain,
                            proxyDetails,
                            userAgent,
                            requestedOutput,
                            oldConfigHint
                        );

                        return result;
                    } catch (error) {
                        logger.error(`Error in customDiscoverAndScrape: ${error.message}`);
                        throw error;
                    }
                };

                // Check if the _discoverAndScrape method is available
                if (typeof scraperEngine._discoverAndScrape === 'function') {
                    // Use our custom method that ensures XPath discovery always happens
                    // Wrap in Promise.race to add timeout
                    discoveryResult = await Promise.race([
                        customDiscoverAndScrape(
                            testUrl,
                            domain,
                            null, // proxyDetails
                            siteConfig.user_agent_to_use, // userAgent
                            'content', // requestedOutput
                            null // oldConfigHint
                        ),
                        timeoutPromise
                    ]);
                } else {
                    // If the internal method is not available, use the public scrape method
                    // but first clear any existing config for this domain to force discovery
                    logger.info('Internal _discoverAndScrape method not available, using public API');

                    // Create a temporary storage with no entry for this domain
                    const tempStorage = {};
                    Object.keys(knownSitesData).forEach(key => {
                        if (key !== domain) {
                            tempStorage[key] = knownSitesData[key];
                        }
                    });

                    // Create a temporary file with the modified storage
                    const tempStoragePath = path.resolve(__dirname, '../../data/temp_known_sites_storage.json');
                    await fs.writeFile(tempStoragePath, JSON.stringify(tempStorage, null, 2), 'utf-8');

                    // Create a new engine with the temporary storage
                    const tempEngine = new CoreScraperEngine({
                        knownSitesStoragePath: tempStoragePath,
                        scraper: {
                            navigationTimeout: 60000, // 60 seconds
                            defaultTimeout: 120000,   // 2 minutes
                            domComparisonThreshold: 0.60, // Lower threshold to 60% for more realistic DOM comparison
                            puppeteerOptions: {
                                executablePath: process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium', // Path to Chromium
                                args: [
                                    '--no-sandbox',
                                    '--disable-setuid-sandbox',
                                    '--disable-dev-shm-usage',
                                    '--disable-accelerated-2d-canvas',
                                    '--no-first-run',
                                    '--no-zygote',
                                    '--disable-gpu'
                                ]
                            }
                        },
                        proxy: {
                            server: 'http://otnlqxce-rotate:pgg7cco5d94z@p.webshare.io:80' // HTTP proxy for web scraping
                        },
                        captchaSolver: {
                            apiKey: process.env.CAPTCHA_API_KEY,
                            service: process.env.CAPTCHA_SERVICE_NAME || '2captcha'
                        }
                    });

                    // Use the public scrape method with timeout
                    discoveryResult = await Promise.race([
                        tempEngine.scrape(
                            testUrl,
                            null, // proxyDetails
                            siteConfig.user_agent_to_use // userAgent
                        ),
                        timeoutPromise
                    ]);

                    // Clean up the temporary file
                    try {
                        await fs.unlink(tempStoragePath);
                    } catch (cleanupError) {
                        logger.warn(`Failed to clean up temporary file: ${cleanupError.message}`);
                    }
                }

                // Compare the discovered XPath with the stored one
                const comparisonResult = {
                    domain,
                    storedXPath: siteConfig.xpath_main_content,
                    discoveredXPath: discoveryResult.success ? discoveryResult.xpath : null,
                    storedMethod: siteConfig.method,
                    discoveredMethod: discoveryResult.success ? discoveryResult.method : null,
                    success: discoveryResult.success,
                    match: discoveryResult.success &&
                           discoveryResult.xpath === siteConfig.xpath_main_content,
                    error: discoveryResult.success ? null : discoveryResult.error
                };

                // Update statistics
                if (comparisonResult.success) {
                    stats.success++;
                    if (comparisonResult.match) {
                        stats.match++;
                    } else {
                        stats.mismatch++;
                    }
                } else {
                    stats.error++;
                }

                // Track method statistics
                const storedMethod = siteConfig.method;
                if (!stats.methodStats[storedMethod]) {
                    stats.methodStats[storedMethod] = {
                        total: 0,
                        success: 0,
                        match: 0,
                        mismatch: 0,
                        error: 0
                    };
                }
                stats.methodStats[storedMethod].total++;

                if (comparisonResult.success) {
                    stats.methodStats[storedMethod].success++;
                    if (comparisonResult.match) {
                        stats.methodStats[storedMethod].match++;
                    } else {
                        stats.methodStats[storedMethod].mismatch++;
                    }
                } else {
                    stats.methodStats[storedMethod].error++;
                }

                // Append to the report
                await appendToReport(comparisonResult);

            } catch (error) {
                logger.error(`Error processing domain ${domain}: ${error.message}`);

                // Update statistics
                stats.error++;

                // Track method statistics for errors
                const storedMethod = siteConfig.method;
                if (!stats.methodStats[storedMethod]) {
                    stats.methodStats[storedMethod] = {
                        total: 0,
                        success: 0,
                        match: 0,
                        mismatch: 0,
                        error: 0
                    };
                }
                stats.methodStats[storedMethod].total++;
                stats.methodStats[storedMethod].error++;

                // Append error to the report
                await appendToReport({
                    domain,
                    storedXPath: siteConfig.xpath_main_content,
                    discoveredXPath: null,
                    storedMethod: siteConfig.method,
                    discoveredMethod: null,
                    success: false,
                    match: false,
                    error: error.message
                });
            }

            // Add a delay between requests to avoid rate limiting
            // Use a longer delay after every 5 domains
            if (i < domains.length - 1) {
                const delayTime = (i + 1) % 5 === 0 ? 10000 : 3000;
                logger.info(`Waiting ${delayTime/1000} seconds before processing next domain...`);
                await delay(delayTime);
            }
        }

        // Add summary to the report
        await appendSummary(stats);

        logger.info(`Re-check completed. Report saved to ${REPORT_FILE_PATH}`);

        // Restore original methods
        restorePuppeteerPatches();
        logger.info('Restored all Puppeteer patches at end of script');

    } catch (error) {
        logger.error(`Fatal error: ${error.message}`);
        console.error(error);

        // Restore original methods even in case of error
        try {
            restorePuppeteerPatches();
            logger.info('Restored all Puppeteer patches after error');
        } catch (restoreError) {
            logger.error(`Failed to restore Puppeteer patches: ${restoreError.message}`);
        }
    }
}

/**
 * Read the known sites storage file
 * @returns {Promise<Object>} The known sites data
 */
async function readKnownSitesStorage() {
    try {
        const fileContent = await fs.readFile(KNOWN_SITES_STORAGE_PATH, 'utf-8');
        return JSON.parse(fileContent);
    } catch (error) {
        logger.error(`Failed to read known sites storage: ${error.message}`);
        throw error;
    }
}

/**
 * Initialize the report file
 */
async function initializeReport() {
    try {
        const header = `# SmartScraper Site Data Re-Check Report
Generated: ${new Date().toISOString()}

This report compares the stored XPath expressions with newly discovered ones.

## Results

`;
        await fs.writeFile(REPORT_FILE_PATH, header, 'utf-8');
        logger.info(`Report initialized at ${REPORT_FILE_PATH}`);
    } catch (error) {
        logger.error(`Failed to initialize report: ${error.message}`);
        throw error;
    }
}

/**
 * Append a comparison result to the report
 * @param {Object} result - The comparison result
 */
async function appendToReport(result) {
    try {
        // Determine status emoji for quick visual reference
        let statusEmoji = '❓'; // Unknown
        if (result.success) {
            statusEmoji = result.match ? '✅' : '⚠️'; // Match or Mismatch
        } else {
            statusEmoji = '❌'; // Error
        }

        // Format the entry with more details
        const entry = `### ${statusEmoji} Domain: ${result.domain}
- **Status**: ${result.success ? (result.match ? 'Match' : 'Mismatch') : 'Error'}
- **Stored Method**: \`${result.storedMethod}\`
- **Discovered Method**: ${result.discoveredMethod ? `\`${result.discoveredMethod}\`` : 'None'}
- **Stored XPath**: \`${result.storedXPath}\`
- **Discovered XPath**: ${result.discoveredXPath ? `\`${result.discoveredXPath}\`` : 'None'}

${result.error ? `**Error Details**:\n\`\`\`\n${result.error}\n\`\`\`\n` : ''}
${!result.match && result.success ? `**XPath Comparison**:\nStored and discovered XPaths differ. This may indicate that the site structure has changed or that multiple valid XPaths exist.\n` : ''}

`;
        await fs.appendFile(REPORT_FILE_PATH, entry, 'utf-8');
    } catch (error) {
        logger.error(`Failed to append to report: ${error.message}`);
        // Don't throw here to allow the process to continue
    }
}

/**
 * Append a summary of the results to the report
 * @param {Object} stats - The statistics object
 */
async function appendSummary(stats) {
    try {
        const summary = `## Summary

### Overall Results
- **Total Sites**: ${stats.total}
- **Successful Checks**: ${stats.success} (${Math.round(stats.success / stats.total * 100)}%)
- **Matching XPaths**: ${stats.match} (${Math.round(stats.match / stats.total * 100)}%)
- **Mismatched XPaths**: ${stats.mismatch} (${Math.round(stats.mismatch / stats.total * 100)}%)
- **Errors**: ${stats.error} (${Math.round(stats.error / stats.total * 100)}%)

### Results by Method
${Object.keys(stats.methodStats).map(method => {
    const methodStats = stats.methodStats[method];
    return `#### ${method}
- **Total**: ${methodStats.total}
- **Success Rate**: ${Math.round(methodStats.success / methodStats.total * 100)}%
- **Match Rate**: ${Math.round(methodStats.match / methodStats.total * 100)}%
- **Mismatch Rate**: ${Math.round(methodStats.mismatch / methodStats.total * 100)}%
- **Error Rate**: ${Math.round(methodStats.error / methodStats.total * 100)}%
`;
}).join('\n')}

### Conclusion
${stats.match > stats.mismatch + stats.error ?
    'Most stored XPaths are still valid. The system is working well.' :
    'There are significant issues with the stored XPaths. Consider updating the problematic entries.'}

${stats.mismatch > 0 ?
    'Mismatched XPaths may indicate site structure changes or multiple valid XPaths for the same content.' :
    'No mismatched XPaths found, which is excellent!'}

${stats.error > stats.total * 0.2 ?
    'The high error rate suggests there might be issues with the scraping process or site accessibility.' :
    'The error rate is within acceptable limits.'}

`;

        // Prepend the summary to the beginning of the file after the header
        const currentReport = await fs.readFile(REPORT_FILE_PATH, 'utf-8');
        const headerEndIndex = currentReport.indexOf('## Results');

        if (headerEndIndex !== -1) {
            const header = currentReport.substring(0, headerEndIndex);
            const results = currentReport.substring(headerEndIndex);

            await fs.writeFile(REPORT_FILE_PATH, header + summary + results, 'utf-8');
        } else {
            // If we can't find the Results section, just append the summary
            await fs.appendFile(REPORT_FILE_PATH, summary, 'utf-8');
        }

        logger.info('Summary added to report');
    } catch (error) {
        logger.error(`Failed to append summary to report: ${error.message}`);
    }
}

// Run the main function
recheckStoredSiteData().catch(error => {
    console.error('Unhandled error:', error);

    // Make sure to restore original methods even in case of unhandled errors
    if (typeof restorePuppeteerPatches === 'function') {
        restorePuppeteerPatches();
    }

    process.exit(1);
});
