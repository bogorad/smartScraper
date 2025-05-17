#!/bin/sh
# This is a shell archive (shar).
# To extract, save this file as e.g. fix_bug_1.shar,
# make it executable (chmod +x fix_bug_1.shar),
# and run it from your project's root directory (./fix_bug_1.shar).
# This will overwrite src/core/engine.js. PLEASE BACK UP YOUR WORK.

echo "x - Creating directories (if they don't exist)"
mkdir -p src/core || exit 1

echo "x - Fixing src/core/engine.js (Critical Bug #1: Incorrect config key)"
cat > src/core/engine.js << 'SHAR_EOF'
// src/core/engine.js
// Enhanced debug logging for success paths and decision points.
// HTML content removed from error details.
// Corrected import for HtmlAnalyserFixed.
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';

// Import configurations
import { scraperSettings, llmConfig, captchaSolverConfig } from '../../config/index.js';

// Import core components and utilities
import { KnownSitesManager } from '../storage/known-sites-manager.js';
import { PluginManager } from '../browser/plugin-manager.js';
import { PuppeteerController } from '../browser/puppeteer-controller.js';
import { HtmlAnalyserFixed as HtmlAnalyser } from '../analysis/html-analyser-fixed.js'; // Corrected import: Use named import and alias it
import { DomComparator } from '../analysis/dom-comparator.js';
import { ContentScoringEngine } from '../analysis/content-scoring-engine.js';
import { LLMInterface } from '../services/llm-interface.js';
import { CaptchaSolver } from '../services/captcha-solver.js';
import { fetchWithCurl } from '../network/curl-handler.js';
import { logger } from '../utils/logger.js';
import { normalizeDomain } from '../utils/url-helpers.js';
import { OUTPUT_TYPES, METHODS } from '../constants.js';
import { ScraperError, NetworkError, CaptchaError, ExtractionError, ConfigurationError } from '../utils/error-handler.js';

class CoreScraperEngine {
  constructor() {
    logger.debug('[CoreScraperEngine CONSTRUCTOR] Initializing...');
    // Assign configurations to an instance variable
    // CRITICAL BUG FIX: Changed 'captcha' key to 'captchaSolver'
    this.configs = {
      scraper: scraperSettings,
      llm: llmConfig,
      captchaSolver: captchaSolverConfig // Corrected key
    };
    logger.debug('[CoreScraperEngine CONSTRUCTOR] Loaded configurations:', JSON.stringify(Object.keys(this.configs)));
    logger.debug('[CoreScraperEngine CONSTRUCTOR] Scraper settings:', this.configs.scraper);


    // Validate essential configurations
    if (!this.configs.scraper) throw new ConfigurationError('Scraper configuration is missing.');
    if (!this.configs.llm) throw new ConfigurationError('LLM configuration is missing.');
    if (!this.configs.captchaSolver) throw new ConfigurationError('CAPTCHA solver configuration is missing.'); // This check will now pass

    // Initialize managers and controllers
    this.knownSitesManager = new KnownSitesManager(this.configs.scraper.knownSitesStoragePath);
    logger.debug('[CoreScraperEngine CONSTRUCTOR] KnownSitesManager initialized.');

    this.pluginManager = new PluginManager(this.configs.scraper.extensionPaths);
    logger.debug('[CoreScraperEngine CONSTRUCTOR] PluginManager initialized.');

    this.puppeteerController = new PuppeteerController(this.pluginManager, this.configs.scraper);
    logger.debug('[CoreScraperEngine CONSTRUCTOR] PuppeteerController initialized.');

    this.htmlAnalyser = new HtmlAnalyser(); // This will now correctly use the aliased HtmlAnalyserFixed
    logger.debug('[CoreScraperEngine CONSTRUCTOR] HtmlAnalyser (HtmlAnalyserFixed) initialized.');

    this.domComparator = new DomComparator(this.configs.scraper.domComparisonThreshold);
    logger.debug('[CoreScraperEngine CONSTRUCTOR] DomComparator initialized.');

    this.contentScoringEngine = new ContentScoringEngine(
      this.configs.scraper.scoreWeights,
      this.configs.scraper.minParagraphThreshold,
      this.configs.scraper.descriptiveKeywords
    );
    logger.debug('[CoreScraperEngine CONSTRUCTOR] ContentScoringEngine initialized.');

    this.llmInterface = new LLMInterface(this.configs.llm);
    logger.debug('[CoreScraperEngine CONSTRUCTOR] LLMInterface initialized.');

    this.captchaSolver = new CaptchaSolver(this.configs.captchaSolver, this.knownSitesManager);
    logger.debug('[CoreScraperEngine CONSTRUCTOR] CaptchaSolver initialized.');

    logger.info('CoreScraperEngine initialized with HtmlAnalyserFixed (as HtmlAnalyser) and enhanced ContentScoringEngine.');
  }

  async _saveDebugHtml(type, domain, urlString, htmlContent) {
    if (!this.configs.scraper.debug) {
      // logger.debug(`[DEBUG_MODE][SAVE_HTML] Debug mode is off. Not saving HTML for ${urlString}.`); // Already too verbose if debug is off
      return;
    }
    if (type === 'success' && !this.configs.scraper.saveHtmlOnSuccessNav) {
      logger.debug(`[DEBUG_MODE][SAVE_HTML] Conditions not met to save 'success' HTML for ${urlString}. SaveOnSuccessNav: ${this.configs.scraper.saveHtmlOnSuccessNav}`);
      return;
    }
    if (typeof htmlContent !== 'string' || !htmlContent.trim()) {
      logger.debug(`[DEBUG_MODE][SAVE_HTML] Not saving HTML for ${urlString}: HTML content is empty or not a string.`);
      return; // Don't save empty content
    }

    const dumpPathConfig = type === 'success' ? this.configs.scraper.successHtmlDumpPath : this.configs.scraper.failedHtmlDumpPath;
    if (!dumpPathConfig) {
        logger.warn(`[DEBUG_MODE][SAVE_HTML] HTML dump path for type '${type}' is not configured. Cannot save HTML.`);
        return;
    }

    try {
      const dumpDir = path.resolve(dumpPathConfig); // Ensure it's an absolute path
      await fs.mkdir(dumpDir, { recursive: true });
      const parsedUrl = new URL(urlString);
      const safePathname = parsedUrl.pathname.replace(/^\//, '').replace(/\/$/, '')
        .replace(/\//g, '_')
        .replace(/[^a-zA-Z0-9_.-]/g, '_').substring(0, 100);
      const safeHostname = parsedUrl.hostname.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const filename = `${safeHostname}${safePathname ? '_' + safePathname : ''}_${type}_${Date.now()}.html`;
      const filePath = path.join(dumpDir, filename);
      await fs.writeFile(filePath, htmlContent);
      logger.info(`[DEBUG_MODE][SAVE_HTML] Saved ${type} HTML to ${filePath} for URL: ${urlString}`);
    } catch (saveError) {
      logger.warn(`[DEBUG_MODE][SAVE_HTML] Failed to save ${type} HTML for ${urlString}: ${saveError.message}`);
    }
  }


  async scrape(targetUrl, proxyDetails = null, userAgentString = null, requestedOutput = OUTPUT_TYPES.CONTENT_ONLY) {
    logger.debug(`[CoreScraperEngine SCRAPE_MAIN] Entry point. URL: ${targetUrl}, Output: ${requestedOutput}`);
    logger.info(`Starting scrape for URL: ${targetUrl}`);

    let browser = null;
    let page = null;
    let domain = null;
    let siteConfig = null;

    try {
      domain = normalizeDomain(targetUrl);
      logger.debug(`[CoreScraperEngine SCRAPE_MAIN] Normalized domain: ${domain}`);
      if (!domain) {
        const errorMsg = `Invalid URL or could not normalize domain: ${targetUrl}`;
        logger.error(errorMsg);
        throw new ConfigurationError(errorMsg, { url: targetUrl });
      }

      let effectiveProxy = proxyDetails;
      if (!effectiveProxy && this.configs.scraper.httpProxy) {
        logger.info(`Using default proxy from HTTP_PROXY environment variable for ${targetUrl}`);
        try {
            const proxyUrl = new URL(this.configs.scraper.httpProxy);
            effectiveProxy = {
                server: this.configs.scraper.httpProxy, // Full string for parsing by handlers
                username: proxyUrl.username ? decodeURIComponent(proxyUrl.username) : undefined,
                password: proxyUrl.password ? decodeURIComponent(proxyUrl.password) : undefined,
            };
        } catch (e) {
            logger.error(`[CoreScraperEngine SCRAPE_MAIN] Invalid HTTP_PROXY format: ${this.configs.scraper.httpProxy}. Error: ${e.message}`);
            throw new ConfigurationError(`Invalid HTTP_PROXY format: ${this.configs.scraper.httpProxy}`, { originalError: e.message });
        }
      }
      logger.debug(`[CoreScraperEngine SCRAPE_MAIN] Effective proxy: ${effectiveProxy ? JSON.stringify(effectiveProxy) : 'None'}`);

      const effectiveUserAgent = userAgentString || this.configs.scraper.defaultUserAgent;
      logger.debug(`[CoreScraperEngine SCRAPE_MAIN] Effective User-Agent: ${effectiveUserAgent}`);

      try {
        siteConfig = await this.knownSitesManager.getConfig(domain);
      } catch (e) {
          logger.error(`[CoreScraperEngine SCRAPE_MAIN] Error getting site config for ${domain}: ${e.message}`);
          // Continue as if no config found, but log this as it's unexpected for storage to fail.
          siteConfig = null;
      }
      logger.debug(`[CoreScraperEngine SCRAPE_MAIN] Site config from KnownSitesManager for ${domain}: ${siteConfig ? `Keys: ${Object.keys(siteConfig).join(', ')}` : 'Not found'}`);


      if (siteConfig) {
        logger.info(`Found known site config for domain: ${domain}`);
        logger.debug(`[CoreScraperEngine SCRAPE_MAIN] Attempting _scrapeWithKnownConfig for ${domain}`);
        try {
            const knownScrapeResult = await this._scrapeWithKnownConfig(targetUrl, siteConfig, effectiveProxy, effectiveUserAgent, requestedOutput);
            logger.debug(`[CoreScraperEngine SCRAPE_MAIN] _scrapeWithKnownConfig result: ${knownScrapeResult !== null ? 'Success' : 'Failure (null)'}`);
            if (knownScrapeResult) {
                logger.debug(`[CoreScraperEngine SCRAPE_MAIN] Known config scrape successful. Returning result.`);
                return knownScrapeResult;
            }
            // If knownScrapeResult is null, it means an operational failure occurred that _scrapeWithKnownConfig handled by returning null.
            logger.warn(`Scraping with known config failed for ${domain}. Triggering re-discovery.`);
            await this.knownSitesManager.incrementFailure(domain);
        } catch (error) {
            logger.warn(`Error during _scrapeWithKnownConfig for ${domain}: ${error.message}. Triggering re-discovery.`);
            if (scraperSettings.debug) {
                logger.error(`[DEBUG_MODE] Full error during _scrapeWithKnownConfig for ${domain}:`, error);
            }
            await this.knownSitesManager.incrementFailure(domain);
            // Fall through to discovery
        }
      }

      logger.info(`No known site config for domain: ${domain} or known config failed. Starting discovery.`);
      logger.debug(`[CoreScraperEngine SCRAPE_MAIN] Attempting _discoverAndScrape for ${domain}`);
      const discoveryResult = await this._discoverAndScrape(targetUrl, domain, effectiveProxy, effectiveUserAgent, requestedOutput);
      logger.debug(`[CoreScraperEngine SCRAPE_MAIN] _discoverAndScrape successful. Returning result.`);
      return discoveryResult;

    } catch (error) {
      logger.error(`[CoreScraperEngine SCRAPE_MAIN] Top-level error in scrape for ${targetUrl}: ${error.message} (Error Name: ${error.name})`);
      if (scraperSettings.debug) {
        logger.error(`[DEBUG_MODE] Full error in SCRAPE_MAIN for ${targetUrl}:`, error);
        if (error.stack) logger.debug(`[DEBUG_MODE] Stack: ${error.stack}`);
      }
      // Ensure any created browser is closed if an error bubbles up this far
      if (page && !page.isClosed()) await page.close().catch(e => logger.warn(`Error closing page in SCRAPE_MAIN catch: ${e.message}`));
      if (browser && browser.isConnected()) await browser.close().catch(e => logger.warn(`Error closing browser in SCRAPE_MAIN catch: ${e.message}`));

      throw error; // Re-throw the original error to be handled by scrapeUrl
    }
  }

  async _scrapeWithKnownConfig(url, config, proxyDetails, userAgent, requestedOutput) {
    logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Entry. URL: ${url}, Method: ${config.method}, XPath: ${config.xpath_main_content}`);
    let browser = null;
    let page = null;
    let pageContent = null;
    let errorHtmlToSave = '';

    try {
      const uaToUse = config.user_agent_to_use || userAgent;
      logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Using method: ${config.method}`);

      switch (config.method) {
        case METHODS.CURL:
          logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Attempting fetchWithCurl...`);
          const curlResponse = await fetchWithCurl(url, proxyDetails, config.site_specific_headers, uaToUse);
          if (curlResponse.success) {
            pageContent = curlResponse.html;
            errorHtmlToSave = pageContent.substring(0, 50000); // Truncate for saving on error
            logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] cURL fetch successful. HTML length: ${pageContent?.length}`);
          } else {
            logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] cURL fetch failed: ${curlResponse.error}`);
            await this._saveDebugHtml('failure_curl_knowncfg', config.domain_pattern, url, curlResponse.html || '');
            throw new NetworkError(`cURL fetch failed for known config: ${curlResponse.error}`, { reason: 'curl_fetch_failed_known_config' });
          }
          break;
        case METHODS.PUPPETEER_STEALTH:
          logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Attempting Puppeteer (stealth) launch and navigate...`);
          ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, uaToUse, config.puppeteer_wait_conditions));
          logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Puppeteer navigation successful. Getting page content...`);
          pageContent = await this.puppeteerController.getPageContent(page);
          errorHtmlToSave = pageContent.substring(0, 50000);
          logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Puppeteer content length: ${pageContent?.length}`);
          break;
        case METHODS.PUPPETEER_CAPTCHA:
          logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Attempting Puppeteer (captcha) launch and navigate...`);
          ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, uaToUse, config.puppeteer_wait_conditions));
          logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Puppeteer navigation successful. Attempting CAPTCHA solve...`);
          const captchaSolved = await this.captchaSolver.solveIfPresent(page, url);

          if (!captchaSolved) {
            pageContent = await this.puppeteerController.getPageContent(page).catch(() => null); // Get content even if solve failed for debugging
            errorHtmlToSave = pageContent ? pageContent.substring(0, 50000) : '';
            logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] CAPTCHA solving failed.`);
            await this._saveDebugHtml('failure_captcha_knowncfg', config.domain_pattern, url, pageContent || '');
            throw new CaptchaError('CAPTCHA solving failed or CAPTCHA not found as expected for known config.', { reason: 'captcha_solve_failed_known_config' });
          }
          logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] CAPTCHA solved. Waiting post-load delay...`);
          await page.waitForTimeout(this.configs.scraper.puppeteerPostLoadDelay || 2000);
          logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Getting page content after CAPTCHA...`);
          pageContent = await this.puppeteerController.getPageContent(page);
          errorHtmlToSave = pageContent.substring(0, 50000);
          logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Puppeteer content length after CAPTCHA: ${pageContent?.length}`);
          break;
        default:
          logger.error(`[CoreScraperEngine _scrapeWithKnownConfig] Unknown method in site config: ${config.method}`);
          throw new ConfigurationError(`Unknown method in site config: ${config.method}`);
      }

      if (!pageContent) {
        logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] Failed to retrieve page content.`);
        await this._saveDebugHtml('failure_get_content_knowncfg', config.domain_pattern, url, '');
        throw new ExtractionError('Failed to retrieve page content with known config.', { reason: 'get_content_failed_known_config' });
      }

      logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Page content retrieved. Updating success metrics for ${config.domain_pattern}`);
      await this.knownSitesManager.updateSuccess(config.domain_pattern);
      await this._saveDebugHtml('success', config.domain_pattern, url, pageContent);

      if (requestedOutput === OUTPUT_TYPES.FULL_HTML) {
        logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Requested output is FULL_HTML. Returning full page content.`);
        return { success: true, data: pageContent, method: config.method, xpath: null, outputType: requestedOutput };
      }

      let extractedElementHtml = null;
      if (config.xpath_main_content) {
        logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Extracting content with XPath: ${config.xpath_main_content}`);
        if (config.method === METHODS.CURL) {
          extractedElementHtml = this.htmlAnalyser.extractByXpath(pageContent, config.xpath_main_content);
        } else if (page) { // Puppeteer methods
            const elements = await page.$x(config.xpath_main_content);
            if (elements.length > 0) {
                logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] XPath matched ${elements.length} elements in Puppeteer.`);
                extractedElementHtml = await page.evaluate(el => el.innerHTML, elements[0]);
                for (const el of elements) await el.dispose(); // Dispose all found elements
            } else {
                logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] XPath matched 0 elements in Puppeteer for XPath: ${config.xpath_main_content}`);
            }
        }
      } else {
         throw new ConfigurationError('No XPath defined for known site config and FULL_HTML not requested.', { domain: config.domain_pattern });
      }


      if (!extractedElementHtml) {
        logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] XPath ${config.xpath_main_content} did not yield content.`);
        await this._saveDebugHtml('failure_xpath_extract_knowncfg', config.domain_pattern, url, pageContent);
        throw new ExtractionError(`XPath ${config.xpath_main_content} did not yield content with known config.`, { xpath: config.xpath_main_content, reason: 'xpath_no_yield_known_config' });
      }
      logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Content extracted successfully. Length: ${extractedElementHtml.length}.`);
      return { success: true, data: extractedElementHtml, method: config.method, xpath: config.xpath_main_content, outputType: requestedOutput };

    } catch (error) {
      logger.error(`[CoreScraperEngine _scrapeWithKnownConfig] ${error.name || 'Error'} scraping with known config for ${url}: ${error.message}`);
      if (scraperSettings.debug) {
        logger.error(`[DEBUG_MODE] Full error in _scrapeWithKnownConfig for ${url}:`, error);
        if (error.stack) logger.debug(`[DEBUG_MODE] Stack: ${error.stack}`);
      }
      if (error.details) logger.error(`[CoreScraperEngine _scrapeWithKnownConfig] Error details:`, error.details);

      // Save HTML content at the point of failure if available
      const htmlToSave = errorHtmlToSave || (pageContent ? pageContent.substring(0,50000) : '');
      if (htmlToSave.length > 0) { // Already has length, or was replaced by placeholder
          await this._saveDebugHtml('failure_generic_knowncfg', config.domain_pattern, url, errorHtmlToSave);
      }


      if (error instanceof ScraperError) throw error; // Re-throw known operational errors
      // Wrap unexpected errors
      throw new ScraperError(`Unexpected error in _scrapeWithKnownConfig: ${error.message}`, { originalErrorName: error.name, originalErrorMessage: error.message });
    } finally {
      if (page && !page.isClosed()) {
        logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Cleaning up Puppeteer browser.`);
        await this.puppeteerController.cleanupPuppeteer(browser);
      }
    }
  }

  async _discoverAndScrape(url, domain, proxyDetails, userAgent, requestedOutput) {
    logger.debug(`[CoreScraperEngine _discoverAndScrape] Entry. URL: ${url}, Domain: ${domain}`);
    let browser = null;
    let page = null;
    let curlHtml = null;
    let puppeteerHtml = null;
    let htmlForAnalysis = null;
    let tentativeMethodIsCurl = false;
    let discoveredNeedsCaptcha = false;
    let pageContentForError = ''; // To store HTML content at the point of error for debugging

    try {
      logger.debug(`[CoreScraperEngine _discoverAndScrape] Step 1: Initial Probing...`);
      const curlResponse = await fetchWithCurl(url, proxyDetails, null, userAgent).catch(e => {
        logger.warn(`[CoreScraperEngine _discoverAndScrape] cURL fetch raw error: ${e.message}`);
        return { success: false, error: e.message, html: e.details?.htmlContent || '' };
      });

      pageContentForError = curlResponse.html || ''; // Initial error content

      if (curlResponse.success && curlResponse.html) {
        curlHtml = curlResponse.html;
        logger.debug(`[CoreScraperEngine _discoverAndScrape] cURL fetch successful. HTML length: ${curlHtml?.length}.`);
        if (this.htmlAnalyser.detectCaptchaMarkers(curlHtml)) {
          logger.info('[CoreScraperEngine _discoverAndScrape] CAPTCHA detected in cURL response.');
          discoveredNeedsCaptcha = true;
          if (curlHtml.includes('captcha-delivery.com') || curlHtml.includes('geo.captcha-delivery.com')) {
            logger.info('[CoreScraperEngine _discoverAndScrape] DataDome CAPTCHA detected in cURL. Prioritizing Puppeteer CAPTCHA flow.');
            ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, userAgent));
            pageContentForError = await this.puppeteerController.getPageContent(page).catch(() => curlHtml);
            const solved = await this.captchaSolver.solveIfPresent(page, url);
            if (!solved) {
              await this._saveDebugHtml('failure_datadome_discovery', domain, url, pageContentForError);
              throw new CaptchaError('DataDome CAPTCHA solving failed during discovery.', { reason: 'datadome_solve_failed_discovery' });
            }
            puppeteerHtml = await this.puppeteerController.getPageContent(page).catch(() => null);
            htmlForAnalysis = puppeteerHtml;
            tentativeMethodIsCurl = false; // Puppeteer was used
            logger.debug(`[CoreScraperEngine _discoverAndScrape] Using Puppeteer HTML after DataDome solve. Length: ${htmlForAnalysis?.length}`);
          } else {
            logger.debug(`[CoreScraperEngine _discoverAndScrape] Non-DataDome CAPTCHA in cURL. Will use cURL HTML for initial analysis, Puppeteer may be needed.`);
            htmlForAnalysis = curlHtml; // Use cURL HTML but flag that Puppeteer might be needed
            tentativeMethodIsCurl = true; // Still tentatively cURL, but CAPTCHA is a concern
          }
        } else {
          logger.debug(`[CoreScraperEngine _discoverAndScrape] No CAPTCHA in cURL. Using cURL HTML for analysis.`);
          htmlForAnalysis = curlHtml;
          tentativeMethodIsCurl = true;
        }
      }

      if (!htmlForAnalysis) { // If cURL failed or CAPTCHA flow didn't set htmlForAnalysis
        logger.warn(`[CoreScraperEngine _discoverAndScrape] cURL fetch failed or returned error: ${curlResponse?.error || 'Unknown cURL issue'}`);
        logger.debug(`[CoreScraperEngine _discoverAndScrape] cURL insufficient or failed. Using Puppeteer probe.`);
        ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, userAgent, null, true /* isInitialProbe */));
        puppeteerHtml = await this.puppeteerController.getPageContent(page);
        pageContentForError = puppeteerHtml || pageContentForError; // Update error content
        logger.debug(`[CoreScraperEngine _discoverAndScrape] Puppeteer probe HTML length: ${puppeteerHtml?.length}.`);
        if (this.htmlAnalyser.detectCaptchaMarkers(puppeteerHtml)) {
          logger.info('[CoreScraperEngine _discoverAndScrape] CAPTCHA detected in Puppeteer probe response.');
          discoveredNeedsCaptcha = true;
          const solved = await this.captchaSolver.solveIfPresent(page, url);
          if (!solved) {
            await this._saveDebugHtml('failure_captcha_puppeteer_probe', domain, url, pageContentForError);
            throw new CaptchaError('CAPTCHA solving failed during Puppeteer probe.', { reason: 'captcha_solve_failed_puppeteer_probe' });
          }
          puppeteerHtml = await this.puppeteerController.getPageContent(page); // Get fresh content
          logger.debug(`[CoreScraperEngine _discoverAndScrape] Puppeteer HTML after CAPTCHA solve. Length: ${puppeteerHtml?.length}`);
        }
        htmlForAnalysis = puppeteerHtml;
        tentativeMethodIsCurl = false; // Puppeteer was used
      }

      if (!htmlForAnalysis) {
        logger.error(`[CoreScraperEngine _discoverAndScrape] Failed to retrieve any HTML content for analysis after all probes.`);
        await this._saveDebugHtml('failure_no_html_for_analysis', domain, url, pageContentForError || '');
        throw new NetworkError('Failed to retrieve any HTML content for analysis after all probes.', { reason: 'no_html_for_analysis' });
      }
      pageContentForError = htmlForAnalysis; // Update with the HTML chosen for analysis

      logger.debug(`[CoreScraperEngine _discoverAndScrape] HTML for analysis chosen. Length: ${htmlForAnalysis?.length}. Tentative method is cURL: ${tentativeMethodIsCurl}. Needs CAPTCHA: ${discoveredNeedsCaptcha}`);


      // Step 2: DOM Comparison (if both available and cURL is clean)
      if (curlHtml && puppeteerHtml && !this.htmlAnalyser.detectCaptchaMarkers(curlHtml) && !discoveredNeedsCaptcha) {
        logger.debug(`[CoreScraperEngine _discoverAndScrape] Step 2: DOM Comparison (cURL vs Puppeteer)...`);
        const areSimilar = await this.domComparator.compareDoms(curlHtml, puppeteerHtml);
        logger.debug(`[CoreScraperEngine _discoverAndScrape] DOMs similar: ${areSimilar}.`);
        if (areSimilar) {
          logger.info('[CoreScraperEngine _discoverAndScrape] cURL and Puppeteer DOMs are similar, and cURL is clean. Prioritizing cURL for analysis.');
          htmlForAnalysis = curlHtml;
          tentativeMethodIsCurl = true;
          // Close Puppeteer if it was opened for probing and no longer needed
          if (page && !page.isClosed()) { await this.puppeteerController.cleanupPuppeteer(browser); browser = null; page = null; }
        } else {
          logger.info(`[CoreScraperEngine _discoverAndScrape] DOMs differ. Using Puppeteer output for analysis (already set as htmlForAnalysis).`);
          tentativeMethodIsCurl = false; // Ensure Puppeteer is marked as the source
        }
      } else if (tentativeMethodIsCurl && (discoveredNeedsCaptcha || this.htmlAnalyser.detectCaptchaMarkers(curlHtml))) {
          logger.info('[CoreScraperEngine _discoverAndScrape] cURL HTML has CAPTCHA or needs it; switching to Puppeteer HTML if available.');
          if (puppeteerHtml) {
              htmlForAnalysis = puppeteerHtml;
              tentativeMethodIsCurl = false;
          } else { // Puppeteer wasn't run or failed, and cURL is unusable due to CAPTCHA
              logger.error('[CoreScraperEngine _discoverAndScrape] cURL has CAPTCHA and no usable Puppeteer HTML. Cannot proceed with discovery.');
              await this._saveDebugHtml('failure_captcha_no_fallback', domain, url, curlHtml);
              throw new CaptchaError('cURL HTML unusable due to CAPTCHA and no Puppeteer fallback.', { reason: 'curl_captcha_no_fallback_discovery'});
          }
      } else if (tentativeMethodIsCurl) {
          logger.info('[CoreScraperEngine _discoverAndScrape] Proceeding with cURL HTML for analysis.');
      } else {
          logger.info('[CoreScraperEngine _discoverAndScrape] Proceeding with Puppeteer HTML for analysis.');
      }


      // If using Puppeteer HTML, perform full interactions
      if (!tentativeMethodIsCurl && page && !page.isClosed()) {
        logger.debug('[CoreScraperEngine _discoverAndScrape] Performing full interactions on Puppeteer page for discovery.');
        await this.puppeteerController.performInteractions(page);
        const freshPuppeteerHtml = await this.puppeteerController.getPageContent(page);
        if (freshPuppeteerHtml) {
            logger.debug(`[CoreScraperEngine _discoverAndScrape] HTML after interactions. Length: ${freshPuppeteerHtml?.length}. Updating htmlForAnalysis.`);
            htmlForAnalysis = freshPuppeteerHtml;
            pageContentForError = htmlForAnalysis; // Update error content
        }
        // Check for CAPTCHA again after interactions
        if (this.htmlAnalyser.detectCaptchaMarkers(htmlForAnalysis) && !discoveredNeedsCaptcha) {
            logger.info('[CoreScraperEngine _discoverAndScrape] CAPTCHA detected after full Puppeteer load and interactions. Attempting solve.');
            discoveredNeedsCaptcha = true;
            const solved = await this.captchaSolver.solveIfPresent(page, url);
            if (!solved) {
                await this._saveDebugHtml('failure_captcha_post_interaction', domain, url, pageContentForError);
                throw new CaptchaError('CAPTCHA solving failed after full load and interactions.',{ reason: 'captcha_solve_failed_post_interaction' });
            }
            htmlForAnalysis = await this.puppeteerController.getPageContent(page);
            pageContentForError = htmlForAnalysis; // Update error content
            logger.debug(`[CoreScraperEngine _discoverAndScrape] HTML after post-interaction CAPTCHA solve. Length: ${htmlForAnalysis?.length}`);
        }
      }


      logger.debug(`[CoreScraperEngine _discoverAndScrape] Step 3: LLM XPath Discovery...`);
      logger.info('Preparing simplified DOM for LLM...');
      const simplifiedDomForLlm = this.htmlAnalyser.extractDomStructure(htmlForAnalysis);
      if (!simplifiedDomForLlm && htmlForAnalysis) { // Check if simplification failed but original HTML was present
          logger.error(`[CoreScraperEngine _discoverAndScrape] extractDomStructure returned invalid for URL: ${url}. HTML length: ${htmlForAnalysis?.length}`);
          await this._saveDebugHtml('failure_dom_undefined', domain, url, htmlForAnalysis);
          throw new ExtractionError('Failed to extract DOM structure (returned invalid)', { reason: 'dom_structure_invalid' });
      }
      logger.debug(`[CoreScraperEngine _discoverAndScrape] Simplified DOM length: ${simplifiedDomForLlm?.length}.`);

      const snippets = this.htmlAnalyser.extractArticleSnippets(htmlForAnalysis);
      if (!snippets && htmlForAnalysis) {
          logger.error(`[CoreScraperEngine _discoverAndScrape] extractArticleSnippets returned invalid for URL: ${url}. HTML length: ${htmlForAnalysis?.length}`);
          throw new ExtractionError('Failed to extract article snippets (returned invalid)', { reason: 'snippets_invalid' });
      }
      logger.debug(`[CoreScraperEngine _discoverAndScrape] Extracted ${snippets?.length} snippets for LLM.`);

      let bestXPath = null;
      let bestScore = -Infinity;
      const llmFeedback = [];

      for (let i = 0; i < this.configs.scraper.maxLlmRetries; i++) {
        logger.info(`LLM attempt ${i + 1}/${this.configs.scraper.maxLlmRetries} for ${url}`);
        const candidateXPaths = await this.llmInterface.getCandidateXPaths(simplifiedDomForLlm, snippets, llmFeedback);
        logger.debug(`[CoreScraperEngine _discoverAndScrape] LLM attempt ${i+1} returned ${candidateXPaths?.length || 0} candidates: ${JSON.stringify(candidateXPaths)}`);

        if (!candidateXPaths || candidateXPaths.length === 0) {
          const feedbackMsg = `LLM returned no candidates.`;
          if (!llmFeedback.some(f => typeof f === 'string' && f.includes(feedbackMsg.substring(0,20)))) llmFeedback.push(feedbackMsg);
          logger.warn(feedbackMsg + ` on attempt ${i + 1}`);
          if (i === this.configs.scraper.maxLlmRetries - 1) {
            logger.debug(`[CoreScraperEngine _discoverAndScrape] Max LLM retries reached with no candidates.`);
          }
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait before retrying
          continue;
        }

        let foundXPathInAttempt = null;
        let bestScoreInAttempt = -Infinity;
        const attemptFeedback = [];

        for (const xpath of candidateXPaths) {
          logger.debug(`[CoreScraperEngine _discoverAndScrape] Scoring XPath: ${xpath}`);
          let details;
          try {
            details = tentativeMethodIsCurl ?
              this.htmlAnalyser.queryStaticXPathWithDetails(htmlForAnalysis, xpath) :
              await this.puppeteerController.queryXPathWithDetails(page, xpath);
          } catch (queryError) {
            logger.warn(`[CoreScraperEngine _discoverAndScrape] Error querying XPath "${xpath}": ${queryError.message}`);
            attemptFeedback.push({ xpath, result: `Error querying: ${queryError.message.substring(0,50)}`});
            continue;
          }


          if (details && details.element_found_count > 0) {
            logger.debug(`[CoreScraperEngine _discoverAndScrape] Details for XPath "${xpath}": found_count=${details.element_found_count}, tagName=${details.tagName}, pCount=${details.paragraphCount}, textLen=${details.textContentLength}`);
            const score = this.contentScoringEngine.scoreElement(details);
            logger.debug(`[CoreScraperEngine _discoverAndScrape] XPath "${xpath}" scored: ${score.toFixed(2)}`);
            attemptFeedback.push({ xpath, result: `Score ${score.toFixed(2)} (P:${details.paragraphCount || 0}, TL:${details.textContentLength || 0}, Found:${details.element_found_count})` });
            if (score > bestScoreInAttempt) {
              bestScoreInAttempt = score;
              foundXPathInAttempt = xpath;
            }
          } else {
            attemptFeedback.push({ xpath, result: `Found 0 elements.` });
            logger.debug(`[CoreScraperEngine _discoverAndScrape] XPath "${xpath}" found 0 elements.`);
          }
        }

        if (foundXPathInAttempt && bestScoreInAttempt > bestScore) {
            bestScore = bestScoreInAttempt;
            bestXPath = foundXPathInAttempt;
            if (foundXPathInAttempt) logger.info(`[CoreScraperEngine _discoverAndScrape] New best XPath from attempt ${i+1}: ${foundXPathInAttempt} with score: ${bestScore.toFixed(2)}`);
        }
        
        llmFeedback.push(...attemptFeedback
            .sort((a,b) => parseFloat(b.result.match(/Score (-?\d+\.?\d*)/)?.[1] || -Infinity) - parseFloat(a.result.match(/Score (-?\d+\.?\d*)/)?.[1] || -Infinity) )
            .slice(0,5)); // Add top 5 feedback items from this attempt
        logger.debug(`[CoreScraperEngine _discoverAndScrape] Feedback for next LLM attempt:`, llmFeedback);


        if (bestScore >= this.configs.scraper.minXpathScoreThreshold) {
          logger.info(`[CoreScraperEngine _discoverAndScrape] Sufficiently good XPath found with score ${bestScore.toFixed(2)}. Stopping LLM attempts.`);
          break;
        }
        if (i < this.configs.scraper.maxLlmRetries - 1) {
            logger.info(`[CoreScraperEngine _discoverAndScrape] Current best score ${bestScore.toFixed(2)} is below threshold ${this.configs.scraper.minXpathScoreThreshold}. Retrying with feedback.`);
            await new Promise(resolve => setTimeout(resolve, 1500)); // Wait before retrying
        }
      }

      if (!bestXPath || bestScore < this.configs.scraper.minXpathScoreThreshold) {
        logger.error(`[CoreScraperEngine _discoverAndScrape] XPath discovery failed for ${url} after all retries or score too low (${bestScore.toFixed(2)}).`);
        await this._saveDebugHtml('failure_xpath_discovery', domain, url, htmlForAnalysis);
        throw new ExtractionError('XPath discovery failed or score too low.', {bestScore: bestScore, llmFeedback, reason: 'xpath_discovery_failed_or_low_score'});
      }
      const foundXPath = bestXPath;
      logger.info(`[CoreScraperEngine _discoverAndScrape] Best XPath found: ${foundXPath} with score ${bestScore.toFixed(2)}`);

      logger.debug(`[CoreScraperEngine _discoverAndScrape] Step 4: Determine Method and Save Config...`);
      let methodToStore;
      if (discoveredNeedsCaptcha) {
        methodToStore = METHODS.PUPPETEER_CAPTCHA;
        logger.debug(`[CoreScraperEngine _discoverAndScrape] Method to store: PUPPETEER_CAPTCHA (due to discoveredNeedsCaptcha)`);
      } else if (tentativeMethodIsCurl) {
        logger.debug(`[CoreScraperEngine _discoverAndScrape] Tentative method is cURL. Re-validating XPath on cURL HTML...`);
        const curlValidationContent = this.htmlAnalyser.extractByXpath(curlHtml, foundXPath);
        if (curlValidationContent) {
          methodToStore = METHODS.CURL;
          logger.debug(`[CoreScraperEngine _discoverAndScrape] cURL re-validation successful. Method to store: CURL`);
        } else {
          methodToStore = METHODS.PUPPETEER_STEALTH;
          logger.warn(`[CoreScraperEngine _discoverAndScrape] XPath ${foundXPath} found via cURL analysis but failed re-validation on cURL HTML. Switching to PUPPETEER_STEALTH for ${domain}.`);
          // If Puppeteer was closed, this is a problem. It should ideally still be open if cURL was tentative.
          if (!page || page.isClosed()) {
              logger.warn(`[CoreScraperEngine _discoverAndScrape] Puppeteer instance was closed but now needed for PUPPETEER_STEALTH method. This might lead to issues if not re-probed.`);
              // This situation should be rare if logic is correct, as puppeteerHtml should exist if cURL was not definitive.
          }
        }
      } else {
        methodToStore = METHODS.PUPPETEER_STEALTH;
        logger.debug(`[CoreScraperEngine _discoverAndScrape] Method to store: PUPPETEER_STEALTH (Puppeteer was primary for analysis or cURL not viable)`);
      }

      const newConfig = {
        domain_pattern: domain,
        method: methodToStore,
        xpath_main_content: foundXPath,
        last_successful_scrape_timestamp: new Date().toISOString(), // Mark as successful now
        failure_count_since_last_success: 0,
        site_specific_headers: null, // Can be refined later
        user_agent_to_use: userAgent, // Store the UA that worked
        needs_captcha_solver: discoveredNeedsCaptcha,
        puppeteer_wait_conditions: null, // Can be refined later
        discovered_by_llm: true,
      };
      logger.debug(`[CoreScraperEngine _discoverAndScrape] New config to save for ${domain}:`, newConfig);
      await this.knownSitesManager.saveConfig(domain, newConfig);
      logger.info(`New config saved for ${domain}. Method: ${methodToStore}, XPath: ${foundXPath}`);

      logger.debug(`[CoreScraperEngine _discoverAndScrape] Step 5: Scrape with newly discovered config...`);
      await this._saveDebugHtml('success_discovery_phase', domain, url, htmlForAnalysis); // Save the HTML that led to discovery

      const finalResult = await this._scrapeWithKnownConfig(url, newConfig, proxyDetails, userAgent, requestedOutput);
      if (!finalResult || !finalResult.success) {
          logger.error(`[CoreScraperEngine _discoverAndScrape] Scraping with newly discovered config FAILED unexpectedly.`);
          // This is a significant issue, as discovery succeeded but immediate scrape failed.
          throw new ExtractionError("Scraping with newly discovered config failed unexpectedly.", { reason: 'scrape_with_new_config_failed' });
      }
      logger.debug(`[CoreScraperEngine _discoverAndScrape] Final result from scraping with new config obtained successfully.`);
      return finalResult;

    } catch (error) {
      logger.error(`[CoreScraperEngine _discoverAndScrape] ${error.name || 'Error'} during discovery/scrape for ${url}: ${error.message}`);
      if (scraperSettings.debug) {
        logger.error(`[DEBUG_MODE] Full error in _discoverAndScrape for ${url}:`, error);
      }
      if (error.details) logger.error(`[CoreScraperEngine _discoverAndScrape] Error details:`, error.details);

      const finalErrorHtmlContent = pageContentForError || (htmlForAnalysis ? htmlForAnalysis.substring(0,50000) : '');
      logger.debug(`[CoreScraperEngine _discoverAndScrape] HTML content at time of error (length: ${finalErrorHtmlContent?.length}): ${finalErrorHtmlContent ? finalErrorHtmlContent.substring(0, 200) + '...' : 'N/A'}`);
      if (finalErrorHtmlContent.length > 0) { // It's already a length or placeholder
        await this._saveDebugHtml('failure_discover_scrape', domain, url, finalErrorHtmlContent);
      }


      if (error instanceof ScraperError) throw error;
      const errorDetailsForThrow = { originalErrorName: error.name, originalErrorMessage: error.message };
      if (error.details) Object.assign(errorDetailsForThrow, error.details);
      throw new ScraperError(`Discovery and scraping failed for ${url}: ${error.message}`, errorDetailsForThrow);

    } finally {
      if (page && !page.isClosed()) {
        logger.debug(`[CoreScraperEngine _discoverAndScrape] Cleaning up Puppeteer browser.`);
        await this.puppeteerController.cleanupPuppeteer(browser);
      }
    }
  }
}

export { CoreScraperEngine };
SHAR_EOF

echo "x - Finished extracting files."
echo "Critical Bug #1 has been addressed in src/core/engine.js."
exit 0
