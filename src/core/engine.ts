// src/core/engine.ts
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';

import { 
    scraperSettings as configScraperInstance,
    llmConfig as configLlmInstance,
    captchaSolverConfig as configCaptchaInstance,
    ScraperSettings, 
    LLMConfig,       
    CaptchaSolverConfig 
} from '../../config/index.js';
import { KnownSitesManager, SiteConfig } from '../storage/known-sites-manager.js';
import { PluginManager } from '../browser/plugin-manager.js';
import { PuppeteerController, ProxyDetails as PuppeteerProxyDetails, XPathQueryDetails } from '../browser/puppeteer-controller.js';
import { HtmlAnalyserFixed as HtmlAnalyser } from '../analysis/html-analyser-fixed.js';
import { DomComparator } from '../analysis/dom-comparator.js';
import { ContentScoringEngine, ElementDetails } from '../analysis/content-scoring-engine.js';
import { LLMInterface } from '../services/llm-interface.js';
import { CaptchaSolver } from '../services/captcha-solver.js';

import { logger } from '../utils/logger.js';
import { normalizeDomain } from '../utils/url-helpers.js';
import { OUTPUT_TYPES, METHODS, OutputTypeValue, MethodValue } from '../constants.js';
import { ScraperError, NetworkError, CaptchaError, ExtractionError, ConfigurationError } from '../utils/error-handler.js';
import { Browser, Page, ElementHandle, JSHandle, HTTPResponse } from 'puppeteer';

interface EngineConfigs {
    scraper: ScraperSettings;
    llm: LLMConfig;
    captchaSolver: CaptchaSolverConfig;
}

export interface ScrapeResult {
    success: boolean;
    data?: string | null;
    method?: MethodValue | string | null;
    xpath?: string | null;
    error?: string;
    errorType?: string;
    details?: any;
    outputType: OutputTypeValue;
}

async function evaluateXPathQuery(page: Page, xpath: string): Promise<ElementHandle<Node>[]> {
    logger.debug(`[evaluateXPathQuery] Evaluating XPath: ${xpath}`);
    try {
        // Use page.evaluateHandle with document.evaluate (modern Puppeteer compatible method)
        const jsHandle: JSHandle<Node[]> = await page.evaluateHandle((xpathSelector) => {
            const results: Node[] = [];
            const query = document.evaluate(xpathSelector, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
            let node = query.iterateNext();
            while (node) {
                results.push(node);
                node = query.iterateNext();
            }
            return results;
        }, xpath);

        const properties = await jsHandle.getProperties();
        const children: ElementHandle<Node>[] = [];
        for (const property of properties.values()) {
            const element = property.asElement();
            if (element) children.push(element as ElementHandle<Node>);
        }
        await jsHandle.dispose();

        logger.debug(`[evaluateXPathQuery] XPath "${xpath}" found ${children.length} elements`);
        return children;
    } catch (evalError: any) {
        logger.error(`[evaluateXPathQuery] Error evaluating XPath "${xpath}": ${evalError.message}`);
        throw new ExtractionError(`Error evaluating XPath: ${xpath}`, { originalError: evalError });
    }
}


class CoreScraperEngine {
  private configs: EngineConfigs;
  private knownSitesManager: KnownSitesManager;
  private pluginManager: PluginManager;
  private puppeteerController: PuppeteerController;
  private htmlAnalyser: HtmlAnalyser;
  private domComparator: DomComparator;
  private contentScoringEngine: ContentScoringEngine;
  private llmInterface: LLMInterface;
  private captchaSolver: CaptchaSolver;

  constructor() {
    logger.debug('[CoreScraperEngine CONSTRUCTOR] Initializing...');
    this.configs = {
      scraper: configScraperInstance,
      llm: configLlmInstance,
      captchaSolver: configCaptchaInstance
    };
    logger.debug('[CoreScraperEngine CONSTRUCTOR] Loaded configurations:', JSON.stringify(Object.keys(this.configs)));
    logger.debug('[CoreScraperEngine CONSTRUCTOR] Scraper settings:', this.configs.scraper);

    if (!this.configs.scraper) throw new ConfigurationError('Scraper configuration is missing.');
    if (!this.configs.llm) throw new ConfigurationError('LLM configuration is missing.');
    if (!this.configs.captchaSolver) throw new ConfigurationError('CAPTCHA solver configuration is missing.');

    this.knownSitesManager = new KnownSitesManager(this.configs.scraper.knownSitesStoragePath);
    logger.debug('[CoreScraperEngine CONSTRUCTOR] KnownSitesManager initialized.');

    this.pluginManager = new PluginManager(this.configs.scraper.extensionPaths);
    logger.debug('[CoreScraperEngine CONSTRUCTOR] PluginManager initialized.');

    this.puppeteerController = new PuppeteerController(this.pluginManager, this.configs.scraper);
    logger.debug('[CoreScraperEngine CONSTRUCTOR] PuppeteerController initialized.');

    this.htmlAnalyser = new HtmlAnalyser();
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

  private async _saveDebugHtml(
    type: 'success' | 'failure_captcha_knowncfg' |
          'failure_get_content_knowncfg' | 'failure_xpath_extract_knowncfg' |
          'failure_generic_knowncfg' | 'failure_captcha_solve' |
          'failure_no_html' | 'failure_dom_extraction' |
          'failure_xpath_discovery' | 'failure_unified_puppeteer' |
          'failure_captcha_post_interaction' | 'failure_no_html_for_analysis',
    domain: string,
    urlString: string,
    htmlContent: string | null | undefined
  ): Promise<void> {
    if (!this.configs.scraper.debug) {
      return;
    }
    if (type === 'success' && !this.configs.scraper.saveHtmlOnSuccessNav) {
      logger.debug(`[DEBUG_MODE][SAVE_HTML] Conditions not met to save 'success' HTML for ${urlString}. SaveOnSuccessNav: ${this.configs.scraper.saveHtmlOnSuccessNav}`);
      return;
    }
    if (typeof htmlContent !== 'string' || !htmlContent.trim()) {
      logger.debug(`[DEBUG_MODE][SAVE_HTML] Not saving HTML for ${urlString}: HTML content is empty or not a string.`);
      return;
    }

    const dumpPathConfig = type.startsWith('success') ? this.configs.scraper.successHtmlDumpPath : this.configs.scraper.failedHtmlDumpPath;
    if (!dumpPathConfig) {
        logger.warn(`[DEBUG_MODE][SAVE_HTML] HTML dump path for type '${type}' is not configured. Cannot save HTML.`);
        return;
    }

    try {
      const dumpDir = path.resolve(dumpPathConfig);
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
    } catch (saveError: any) {
      logger.warn(`[DEBUG_MODE][SAVE_HTML] Failed to save ${type} HTML for ${urlString}: ${saveError.message}`);
    }
  }

  async scrape(targetUrl: string, proxyDetails: PuppeteerProxyDetails | null = null, userAgentString: string | null = null, requestedOutput: OutputTypeValue = OUTPUT_TYPES.CONTENT_ONLY as OutputTypeValue): Promise<ScrapeResult> {
    logger.info(`[SCRAPE_STAGE_1] ===== STARTING SCRAPE PROCESS =====`);
    logger.info(`[SCRAPE_STAGE_1] Target URL: ${targetUrl}`);
    logger.info(`[SCRAPE_STAGE_1] Requested Output Type: ${requestedOutput}`);
    logger.info(`[SCRAPE_STAGE_1] User Agent Override: ${userAgentString ? 'YES' : 'NO'}`);
    logger.info(`[SCRAPE_STAGE_1] Proxy Override: ${proxyDetails ? 'YES' : 'NO'}`);

    // Retry logic for banned IP scenarios
    const maxBannedIPRetries = 2; // Allow 2 retries (3 total attempts)
    const bannedIPRetryDelay = 70000; // 70 seconds in milliseconds

    for (let retryAttempt = 0; retryAttempt <= maxBannedIPRetries; retryAttempt++) {
      if (retryAttempt > 0) {
        logger.info(`[BANNED_IP_RETRY] Attempt ${retryAttempt + 1}/${maxBannedIPRetries + 1} after banned IP detection`);
      }

      try {
        return await this._performScrape(targetUrl, proxyDetails, userAgentString, requestedOutput);
      } catch (error: any) {
        // Check if this is a banned IP error
        const isBannedIPError = error.name === 'CaptchaError' &&
                               error.details?.reason === 'banned_ip' &&
                               error.message.includes('banned IP');

        if (isBannedIPError && retryAttempt < maxBannedIPRetries) {
          logger.warn(`[BANNED_IP_RETRY] Banned IP detected on attempt ${retryAttempt + 1}. Pausing for ${bannedIPRetryDelay / 1000} seconds before retry...`);
          logger.info(`[BANNED_IP_RETRY] Error details: ${error.message}`);

          // Wait for the specified delay to allow IP rotation/ban to lift
          await new Promise(resolve => setTimeout(resolve, bannedIPRetryDelay));

          logger.info(`[BANNED_IP_RETRY] Pause completed. Retrying scrape attempt ${retryAttempt + 2}/${maxBannedIPRetries + 1}...`);
          continue; // Retry the scrape
        }

        // If it's not a banned IP error, or we've exhausted retries, throw the error
        if (isBannedIPError) {
          logger.error(`[BANNED_IP_RETRY] Banned IP detected after ${maxBannedIPRetries + 1} attempts. Giving up.`);
        }
        throw error;
      }
    }

    // This should never be reached due to the loop logic, but TypeScript requires it
    throw new ScraperError('Unexpected end of retry loop in scrape method');
  }

  private async _performScrape(targetUrl: string, proxyDetails: PuppeteerProxyDetails | null = null, userAgentString: string | null = null, requestedOutput: OutputTypeValue = OUTPUT_TYPES.CONTENT_ONLY as OutputTypeValue): Promise<ScrapeResult> {
    let browserGR: Browser | null = null;
    let pageGR: Page | null = null;
    let domain: string | null = null;
    let siteConfig: SiteConfig | null = null;

    logger.info(`[SCRAPE_STAGE_2] ===== CONFIGURATION SETUP =====`);
    const effectiveUserAgent = userAgentString || this.configs.scraper.defaultUserAgent;
    logger.info(`[SCRAPE_STAGE_2] Effective User Agent: ${effectiveUserAgent}`);

    try {
      logger.info(`[SCRAPE_STAGE_3] ===== DOMAIN NORMALIZATION =====`);
      domain = normalizeDomain(targetUrl);
      logger.info(`[SCRAPE_STAGE_3] Normalized domain: ${domain}`);
      if (!domain) {
        const errorMsg = `Invalid URL or could not normalize domain: ${targetUrl}`;
        logger.error(`[SCRAPE_STAGE_3] ERROR: ${errorMsg}`);
        throw new ConfigurationError(errorMsg, { url: targetUrl });
      }

      logger.info(`[SCRAPE_STAGE_4] ===== PROXY CONFIGURATION =====`);
      let effectiveProxy = proxyDetails;
      if (!effectiveProxy && this.configs.scraper.httpProxy) {
        logger.info(`[SCRAPE_STAGE_4] Using default proxy from HTTP_PROXY environment variable`);
        logger.info(`[SCRAPE_STAGE_4] HTTP_PROXY value: ${this.configs.scraper.httpProxy}`);
        try {
            const proxyUrl = new URL(this.configs.scraper.httpProxy);
            effectiveProxy = {
                server: this.configs.scraper.httpProxy,
                username: proxyUrl.username ? decodeURIComponent(proxyUrl.username) : undefined,
                password: proxyUrl.password ? decodeURIComponent(proxyUrl.password) : undefined,
            };
            logger.info(`[SCRAPE_STAGE_4] Proxy parsed successfully - Server: ${effectiveProxy.server}`);
            logger.info(`[SCRAPE_STAGE_4] Proxy has credentials: ${effectiveProxy.username ? 'YES' : 'NO'}`);
        } catch (e: any) {
            logger.error(`[SCRAPE_STAGE_4] ERROR: Invalid HTTP_PROXY format: ${this.configs.scraper.httpProxy}. Error: ${e.message}`);
            throw new ConfigurationError(`Invalid HTTP_PROXY format: ${this.configs.scraper.httpProxy}`, { originalError: e.message });
        }
      } else if (effectiveProxy) {
        logger.info(`[SCRAPE_STAGE_4] Using provided proxy override`);
        logger.info(`[SCRAPE_STAGE_4] Proxy server: ${effectiveProxy.server}`);
      }

      // FAIL HARD if no proxy configured - proxy is mandatory
      if (!effectiveProxy || !effectiveProxy.server) {
        logger.error(`[SCRAPE_STAGE_4] CRITICAL: Proxy is required but not configured for URL: ${targetUrl}`);
        throw new ConfigurationError('Proxy configuration is mandatory for all scraping operations. Set HTTP_PROXY environment variable or provide proxyDetails.', { url: targetUrl });
      }

      logger.info(`[SCRAPE_STAGE_4] Final proxy configuration: ${effectiveProxy.server}`);

      logger.info(`[SCRAPE_STAGE_5] ===== SITE CONFIG LOOKUP =====`);
      logger.info(`[SCRAPE_STAGE_5] Looking up config for domain: ${domain}`);
      try {
        siteConfig = await this.knownSitesManager.getConfig(domain);
        logger.info(`[SCRAPE_STAGE_5] Site config lookup completed successfully`);
        if (siteConfig) {
          logger.info(`[SCRAPE_STAGE_5] Found existing config - Method: ${siteConfig.method}`);
          logger.info(`[SCRAPE_STAGE_5] Config XPath: ${siteConfig.xpath_main_content}`);
          logger.info(`[SCRAPE_STAGE_5] Needs CAPTCHA solver: ${siteConfig.needs_captcha_solver}`);
          logger.info(`[SCRAPE_STAGE_5] Last successful scrape: ${siteConfig.last_successful_scrape_timestamp || 'Never'}`);
          logger.info(`[SCRAPE_STAGE_5] Failure count: ${siteConfig.failure_count_since_last_success}`);
        } else {
          logger.info(`[SCRAPE_STAGE_5] No existing config found for domain`);
        }
      } catch (e: any) {
          logger.error(`[SCRAPE_STAGE_5] ERROR getting site config for ${domain}: ${e.message}`);
          siteConfig = null;
      }

      if (siteConfig) {
        logger.info(`[SCRAPE_STAGE_6] ===== KNOWN CONFIG PROCESSING =====`);
        // Check if this is an old config with unsupported method
        if ((siteConfig.method as string) === 'curl') {
          logger.warn(`[SCRAPE_STAGE_6] Found legacy cURL config for ${domain}. Migrating to Puppeteer and triggering re-discovery.`);
          await this.knownSitesManager.deleteConfig(domain);
          siteConfig = null; // Force re-discovery
          logger.info(`[SCRAPE_STAGE_6] Legacy config deleted, will proceed to discovery`);
        } else {
          logger.info(`[SCRAPE_STAGE_6] Attempting to use known site config for domain: ${domain}`);
          logger.info(`[SCRAPE_STAGE_6] Config method: ${siteConfig.method}`);
          try {
              const knownScrapeOutput = await this._scrapeWithKnownConfig(targetUrl, domain, siteConfig, effectiveProxy, effectiveUserAgent, requestedOutput, browserGR, pageGR);
              browserGR = knownScrapeOutput.browser;
              pageGR = knownScrapeOutput.page;

              logger.info(`[SCRAPE_STAGE_6] Known config scrape result: ${knownScrapeOutput.result !== null ? 'Success' : 'Failure (null)'}`);
              if (knownScrapeOutput.result && knownScrapeOutput.result.success) {
                  logger.info(`[SCRAPE_STAGE_6] ===== SCRAPE COMPLETED SUCCESSFULLY WITH KNOWN CONFIG =====`);
                  logger.info(`[SCRAPE_STAGE_6] Method used: ${siteConfig.method}`);
                  logger.info(`[SCRAPE_STAGE_6] Content length: ${knownScrapeOutput.result.data?.length || 0} chars`);
                  return knownScrapeOutput.result;
              }
              logger.warn(`[SCRAPE_STAGE_6] Known config scrape failed for ${domain}. Will trigger re-discovery.`);
              await this.knownSitesManager.incrementFailure(domain);
          } catch (error: any) {
              logger.warn(`[SCRAPE_STAGE_6] Error during known config scrape for ${domain}: ${error.message}. Will trigger re-discovery.`);
              if (this.configs.scraper.debug) {
                  logger.error(`[SCRAPE_STAGE_6] Full error during _scrapeWithKnownConfig for ${domain}:`, error);
              }
              await this.knownSitesManager.incrementFailure(domain);
          }
        }
      }

      logger.info(`[SCRAPE_STAGE_7] ===== STARTING DISCOVERY PROCESS =====`);
      if (!siteConfig) {
        logger.info(`[SCRAPE_STAGE_7] No known site config for domain: ${domain}. Starting unified Puppeteer scraping.`);
      } else {
        logger.info(`[SCRAPE_STAGE_7] Known site config failed for domain: ${domain}. Starting unified Puppeteer scraping.`);
      }
      logger.info(`[SCRAPE_STAGE_7] Discovery method: Unified Puppeteer approach`);
      logger.info(`[SCRAPE_STAGE_7] Will attempt LLM-based XPath discovery`);

      const discoveryOutput = await this._unifiedPuppeteerScrape(targetUrl, domain, effectiveProxy, effectiveUserAgent, requestedOutput, browserGR, pageGR);
      browserGR = discoveryOutput.browser;
      pageGR = discoveryOutput.page;

      logger.info(`[SCRAPE_STAGE_7] Discovery process completed`);
      if (!discoveryOutput.result || !discoveryOutput.result.success) {
          logger.error(`[SCRAPE_STAGE_7] Discovery process failed to return a successful result`);
          throw new ScraperError("Discovery process failed to return a successful scrape result.", discoveryOutput.result?.details || { reason: "discovery_returned_failure" });
      }

      logger.info(`[SCRAPE_STAGE_7] ===== SCRAPE COMPLETED SUCCESSFULLY WITH DISCOVERY =====`);
      logger.info(`[SCRAPE_STAGE_7] Method discovered: ${discoveryOutput.result.method}`);
      logger.info(`[SCRAPE_STAGE_7] XPath discovered: ${discoveryOutput.result.xpath}`);
      logger.info(`[SCRAPE_STAGE_7] Content length: ${discoveryOutput.result.data?.length || 0} chars`);
      return discoveryOutput.result;

    } catch (error: any) {
      logger.error(`[CoreScraperEngine SCRAPE_MAIN] Top-level error in scrape for ${targetUrl}: ${error.message} (Error Name: ${error.name})`);
      if (this.configs.scraper.debug) {
        logger.error(`[DEBUG_MODE] Full error in SCRAPE_MAIN for ${targetUrl}:`, error);
        if (error.stack) logger.debug(`[DEBUG_MODE] Stack: ${error.stack}`);
      }
      throw error;
    } finally {
      if (pageGR && typeof pageGR.isClosed === 'function' && !pageGR.isClosed()) {
        await pageGR.close().catch((e: any) => logger.warn(`Error closing pageGR in SCRAPE_MAIN finally: ${e.message}`));
      }
      if (browserGR && typeof browserGR.isConnected === 'function' && browserGR.isConnected()) {
        await browserGR.close().catch((e: any) => logger.warn(`Error closing browserGR in SCRAPE_MAIN finally: ${e.message}`));
      }
    }
  }

  private async _scrapeWithKnownConfig(
    url: string,
    domain: string,
    config: SiteConfig,
    proxyDetails: PuppeteerProxyDetails | null,
    userAgent: string, // This is the effectiveUserAgent
    requestedOutput: OutputTypeValue,
    browserIn: Browser | null,
    pageIn: Page | null
  ): Promise<{ result: ScrapeResult | null, browser: Browser | null, page: Page | null }> {
    logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Entry. URL: ${url}, Method: ${config.method}, XPath: ${config.xpath_main_content}`);
    let browser: Browser | null = browserIn;
    let page: Page | null = pageIn;
    let pageContent: string | null = null;
    let errorHtmlToSave: string = '';
    let httpStatus: number | undefined;
    let needsConfigUpdate = false;

    try {
      logger.info(`[KNOWN_CONFIG] ===== SCRAPING WITH KNOWN CONFIG =====`);
      logger.info(`[KNOWN_CONFIG] Method: ${config.method}`);
      logger.info(`[KNOWN_CONFIG] XPath: ${config.xpath_main_content}`);
      logger.info(`[KNOWN_CONFIG] User Agent: ${userAgent.substring(0,50)}...`);
      logger.info(`[KNOWN_CONFIG] Needs CAPTCHA solver: ${config.needs_captcha_solver}`);

      switch (config.method) {
        case METHODS.PUPPETEER_STEALTH:
        case METHODS.PUPPETEER_CAPTCHA:
          logger.info(`[KNOWN_CONFIG] Launching Puppeteer with method: ${config.method}`);
          let navigationResponse: HTTPResponse | null = null;
          let navigationError: any = null;

          try {
            if (!page || page.isClosed()) {
              if (browser && browser.isConnected()) await this.puppeteerController.cleanupPuppeteer(browser);
              logger.info(`[KNOWN_CONFIG] Launching new browser and navigating...`);
              const navigateResult = await this.puppeteerController.launchAndNavigate(url, proxyDetails as PuppeteerProxyDetails | null, userAgent, config.puppeteer_wait_conditions);
              browser = navigateResult.browser; page = navigateResult.page;
              // Try to get the response from the last navigation in launchAndNavigate
              navigationResponse = page.mainFrame().childFrames().length > 0 ? await page.mainFrame().childFrames()[0].goto(page.url()) : await page.goto(page.url()); // Re-navigate to get response, can be risky
            } else {
               logger.info(`[KNOWN_CONFIG] Reusing existing page, navigating to URL...`);
               navigationResponse = await this.puppeteerController.navigate(page, url, config.puppeteer_wait_conditions);
            }
          } catch (navError: any) {
            navigationError = navError;
            logger.warn(`[KNOWN_CONFIG] Navigation error occurred: ${navError.message}`);

            // Try to get page content even after navigation error - sometimes the page loads partially
            try {
              if (page && !page.isClosed()) {
                pageContent = await this.puppeteerController.getPageContent(page);
                errorHtmlToSave = pageContent ? pageContent.substring(0, 50000) : '';
                logger.info(`[KNOWN_CONFIG] Retrieved content after navigation error - Length: ${pageContent?.length}`);

                // If we have substantial content (200K+ chars), IGNORE the navigation error and proceed
                if (pageContent && pageContent.length >= 200000) {
                  logger.info(`[KNOWN_CONFIG] Got substantial content (${pageContent.length} chars) despite navigation error. Proceeding with content extraction.`);
                  navigationError = null; // Clear the error - we have good content
                  // Don't return here - just clear the error and continue
                }

                // Only attempt CAPTCHA solving if we have minimal content AND it's a blocking error
                const isBlockingError = navError.message.includes('net::ERR_BLOCKED_BY_RESPONSE') ||
                                       navError.message.includes('ERR_BLOCKED_BY_RESPONSE') ||
                                       navError.message.includes('net::ERR_ACCESS_DENIED') ||
                                       navError.message.includes('ERR_ACCESS_DENIED');

                if (isBlockingError && (config.method as string) !== METHODS.PUPPETEER_CAPTCHA) {
                  logger.info(`[KNOWN_CONFIG] Network-level blocking detected with minimal content (${navError.message}). Attempting CAPTCHA solve.`);

                  const captchaSolved = await this.captchaSolver.solveIfPresent(page, url, userAgent);
                  if (captchaSolved) {
                    logger.info(`[KNOWN_CONFIG] CAPTCHA solved after network blocking. Re-attempting navigation.`);
                    try {
                      navigationResponse = await this.puppeteerController.navigate(page, url, config.puppeteer_wait_conditions);
                      pageContent = await this.puppeteerController.getPageContent(page);
                      errorHtmlToSave = pageContent ? pageContent.substring(0, 50000) : '';
                      httpStatus = navigationResponse?.status();
                      logger.info(`[KNOWN_CONFIG] Navigation successful after CAPTCHA solve - Status: ${httpStatus}, Content Length: ${pageContent?.length}`);
                      needsConfigUpdate = true;
                      navigationError = null; // Clear the error since we recovered
                    } catch (retryNavError: any) {
                      logger.warn(`[KNOWN_CONFIG] Navigation still failed after CAPTCHA solve: ${retryNavError.message}`);
                      // Continue with whatever content we have
                    }
                  } else {
                    logger.warn(`[KNOWN_CONFIG] CAPTCHA solving failed after network blocking.`);
                  }
                }
              }
            } catch (contentError: any) {
              logger.warn(`[KNOWN_CONFIG] Could not retrieve content after navigation error: ${contentError.message}`);
            }

            // If we still have a navigation error and no substantial content, re-throw it
            if (navigationError && (!pageContent || pageContent.length < 10000)) {
              throw navigationError;
            }
          }

          httpStatus = navigationResponse?.status();
          if (!pageContent) {
            pageContent = await this.puppeteerController.getPageContent(page!);
            errorHtmlToSave = pageContent ? pageContent.substring(0, 50000) : '';
          }
          logger.info(`[KNOWN_CONFIG] Navigation completed - Status: ${httpStatus}, Content Length: ${pageContent?.length}`);

          // Check for CAPTCHA regardless of HTTP status - focus on getting content at all costs
          if (page && pageContent &&
              this.htmlAnalyser.detectCaptchaMarkers(pageContent) &&
              (config.method as string) !== METHODS.PUPPETEER_CAPTCHA) { // Added check to prevent re-solving if already P_CAPTCHA
            logger.info(`[KNOWN_CONFIG] CAPTCHA detected on page (status ${httpStatus}). Attempting solve.`);
            const captchaSolved = await this.captchaSolver.solveIfPresent(page, url, userAgent);
            if (captchaSolved) {
              logger.info(`[KNOWN_CONFIG] CAPTCHA solved. Re-fetching content.`);
              pageContent = await this.puppeteerController.getPageContent(page);
              errorHtmlToSave = pageContent ? pageContent.substring(0, 50000) : '';
              const newResponse = await page.goto(page.url(), { waitUntil: 'networkidle0' }).catch(() => null); // Try to get a new response
              httpStatus = newResponse?.status() || httpStatus;
              logger.info(`[KNOWN_CONFIG] Content re-fetched after CAPTCHA. New Status: ${httpStatus}, Length: ${pageContent?.length}`);
              if (!config.needs_captcha_solver || (config.method as string) !== METHODS.PUPPETEER_CAPTCHA) {
                  needsConfigUpdate = true;
              }
            } else {
              logger.warn(`[KNOWN_CONFIG] CAPTCHA detected but solving failed.`);
              await this._saveDebugHtml('failure_captcha_knowncfg', config.domain_pattern, url, pageContent || '');
              throw new CaptchaError('CAPTCHA solving failed.', { reason: 'captcha_solve_failed_known_config' });
            }
          }
          // Continue with content regardless of HTTP status - we got HTML, that's what matters
          break;
        default:
          throw new ConfigurationError(`Unknown method in site config: ${config.method}`);
      }

      if (!pageContent) {
        logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] Failed to retrieve page content after all attempts.`);
        await this._saveDebugHtml('failure_get_content_knowncfg', config.domain_pattern, url, '');
        throw new ExtractionError('Failed to retrieve page content with known config.', { reason: 'get_content_failed_known_config', statusCode: httpStatus });
      }
      
      if (requestedOutput === OUTPUT_TYPES.FULL_HTML) {
        logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Requested output is FULL_HTML.`);
        await this.knownSitesManager.updateSuccess(config.domain_pattern);
        if (needsConfigUpdate) {
            logger.info(`[CoreScraperEngine _scrapeWithKnownConfig] Updating site config for ${domain} due to CAPTCHA solved.`);
            await this.knownSitesManager.saveConfig(domain, { ...config, needs_captcha_solver: true, method: METHODS.PUPPETEER_CAPTCHA });
        }
        await this._saveDebugHtml('success', config.domain_pattern, url, pageContent);
        return { result: { success: true, data: pageContent, method: config.method, xpath: null, outputType: requestedOutput }, browser, page };
      }

      let extractedElementHtml: string | null = null;
      if (!config.xpath_main_content) {
         throw new ConfigurationError('No XPath defined for known site config and CONTENT_ONLY requested.', { domain: config.domain_pattern });
      }
      
      logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Extracting content with XPath: ${config.xpath_main_content}`);
      if (page) {
          const elements: ElementHandle<Node>[] = await evaluateXPathQuery(page, config.xpath_main_content);
          if (elements.length > 0) {
              extractedElementHtml = await page.evaluate(elNode => (elNode && elNode.nodeType === Node.ELEMENT_NODE) ? (elNode as Element).innerHTML : null, elements[0]);
              for (const el of elements) await el.dispose();
          } else {
              logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] XPath matched 0 elements in Puppeteer for XPath: ${config.xpath_main_content}`);
          }
      } else {
          throw new ConfigurationError('Page object not available for XPath extraction in Puppeteer-only mode.');
      }

      if (!extractedElementHtml) {
        logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] Known XPath "${config.xpath_main_content}" did not yield content for ${url}.`);
        await this._saveDebugHtml('failure_xpath_extract_knowncfg', config.domain_pattern, url, pageContent);
        
        // If XPath failed, and we are using Puppeteer, check for CAPTCHA one last time
        if (page && pageContent && this.htmlAnalyser.detectCaptchaMarkers(pageContent) && (config.method as string) !== METHODS.PUPPETEER_CAPTCHA) {
            logger.info(`[KNOWN_CONFIG] CAPTCHA detected after known XPath failed. Attempting CAPTCHA solve.`);
            const captchaSolved = await this.captchaSolver.solveIfPresent(page, url, userAgent);
            if (captchaSolved) {
                logger.info(`[KNOWN_CONFIG] CAPTCHA solved. Re-fetching content and re-trying XPath.`);
                pageContent = await this.puppeteerController.getPageContent(page);
                errorHtmlToSave = pageContent ? pageContent.substring(0, 50000) : ''; // Update errorHtmlToSave
                const elements: ElementHandle<Node>[] = await evaluateXPathQuery(page, config.xpath_main_content);
                if (elements.length > 0) {
                    extractedElementHtml = await page.evaluate(elNode => (elNode && elNode.nodeType === Node.ELEMENT_NODE) ? (elNode as Element).innerHTML : null, elements[0]);
                    for (const el of elements) await el.dispose();
                }
                if (extractedElementHtml) {
                    logger.info(`[KNOWN_CONFIG] Content successfully extracted with known XPath after CAPTCHA solve.`);
                    needsConfigUpdate = true;
                } else {
                    logger.warn(`[KNOWN_CONFIG] Known XPath still failed after CAPTCHA solve.`);
                }
            } else {
                 logger.warn(`[KNOWN_CONFIG] CAPTCHA detected and solving failed.`);
            }
        }
        if (!extractedElementHtml) { // If still no content
            throw new ExtractionError(`XPath ${config.xpath_main_content} did not yield content with known config (even after potential CAPTCHA check).`, { xpath: config.xpath_main_content, reason: 'xpath_no_yield_final_attempt' });
        }
      }
      
      logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Content extracted successfully. Length: ${extractedElementHtml.length}. Updating success metrics.`);
      await this.knownSitesManager.updateSuccess(config.domain_pattern);
      if (needsConfigUpdate) {
          logger.info(`[CoreScraperEngine _scrapeWithKnownConfig] Updating site config for ${domain} due to CAPTCHA solved during known config attempt.`);
          await this.knownSitesManager.saveConfig(domain, { ...config, needs_captcha_solver: true, method: METHODS.PUPPETEER_CAPTCHA });
      }
      await this._saveDebugHtml('success', config.domain_pattern, url, pageContent); 

      return { result: { success: true, data: extractedElementHtml, method: config.method, xpath: config.xpath_main_content, outputType: requestedOutput }, browser, page };

    } catch (error: any) {
      logger.error(`[CoreScraperEngine _scrapeWithKnownConfig] ${error.name || 'Error'} scraping with known config for ${url}: ${error.message}`);
      if (this.configs.scraper.debug) {
        logger.error(`[DEBUG_MODE] Full error in _scrapeWithKnownConfig for ${url}:`, error);
        if (error.stack) logger.debug(`[DEBUG_MODE] Stack: ${error.stack}`);
      }
      if (error.details) logger.error(`[CoreScraperEngine _scrapeWithKnownConfig] Error details:`, error.details);

      const htmlToSave = errorHtmlToSave || (pageContent ? pageContent.substring(0,50000) : '');
      if (htmlToSave.length > 0) {
          await this._saveDebugHtml('failure_generic_knowncfg', config.domain_pattern, url, htmlToSave);
      }
      if (error instanceof ScraperError) throw error;
      throw new ScraperError(`Unexpected error in _scrapeWithKnownConfig: ${error.message}`, { originalErrorName: error.name, originalErrorMessage: error.message });
    }
  }

  private async _unifiedPuppeteerScrape(
    url: string,
    domain: string,
    proxyDetails: PuppeteerProxyDetails | null,
    userAgent: string,
    requestedOutput: OutputTypeValue,
    browserIn: Browser | null,
    pageIn: Page | null
  ): Promise<{ result: ScrapeResult, browser: Browser | null, page: Page | null }> {
    logger.debug(`[CoreScraperEngine _unifiedPuppeteerScrape] Entry. URL: ${url}, Domain: ${domain}`);
    let browser: Browser | null = browserIn;
    let page: Page | null = pageIn;
    let htmlForAnalysis: string | null = null;
    let discoveredNeedsCaptcha = false;
    let pageContentForError: string = '';
    let finalScrapeResult: ScrapeResult | null = null;

    try {
      logger.info(`[DISCOVERY_STAGE_1] ===== STARTING UNIFIED PUPPETEER DISCOVERY =====`);
      logger.info(`[DISCOVERY_STAGE_1] Target URL: ${url}`);
      logger.info(`[DISCOVERY_STAGE_1] Domain: ${domain}`);
      logger.info(`[DISCOVERY_STAGE_1] User Agent: ${userAgent.substring(0,50)}...`);
      logger.info(`[DISCOVERY_STAGE_1] Proxy: ${proxyDetails?.server || 'Default'}`);

      // Step 1: Launch Puppeteer and navigate
      logger.info(`[DISCOVERY_STAGE_2] ===== BROWSER LAUNCH & NAVIGATION =====`);
      let navigationError: any = null;

      try {
        if (!page || page.isClosed()) {
          if (browser && browser.isConnected()) await this.puppeteerController.cleanupPuppeteer(browser);
          logger.info(`[DISCOVERY_STAGE_2] Launching new Puppeteer browser...`);
          const navigateResult = await this.puppeteerController.launchAndNavigate(url, proxyDetails as PuppeteerProxyDetails | null, userAgent, null, true);
          browser = navigateResult.browser;
          page = navigateResult.page;
          logger.info(`[DISCOVERY_STAGE_2] Browser launched and navigation completed successfully`);
        } else {
          logger.info(`[DISCOVERY_STAGE_2] Reusing existing page, navigating to: ${url}`);
          await this.puppeteerController.navigate(page, url, null, true);
          logger.info(`[DISCOVERY_STAGE_2] Navigation to new URL completed`);
        }
      } catch (navError: any) {
        navigationError = navError;
        logger.warn(`[DISCOVERY_STAGE_2] Navigation error occurred: ${navError.message}`);

        // Try to get page content even after navigation error - sometimes the page loads partially
        try {
          if (page && !page.isClosed()) {
            htmlForAnalysis = await this.puppeteerController.getPageContent(page);
            pageContentForError = htmlForAnalysis || '';
            logger.info(`[DISCOVERY_STAGE_2] Retrieved content after navigation error - Length: ${htmlForAnalysis?.length}`);

            // If we have substantial content (200K+ chars), IGNORE the navigation error and proceed
            if (htmlForAnalysis && htmlForAnalysis.length >= 200000) {
              logger.info(`[DISCOVERY_STAGE_2] Got substantial content (${htmlForAnalysis.length} chars) despite navigation error. Proceeding with discovery.`);
              navigationError = null; // Clear the error - we have good content
              // Don't return here - just clear the error and continue
            }

            // Only mark as needing CAPTCHA if we have minimal content AND it's a blocking error
            const isBlockingError = navError.message.includes('net::ERR_BLOCKED_BY_RESPONSE') ||
                                   navError.message.includes('ERR_BLOCKED_BY_RESPONSE') ||
                                   navError.message.includes('net::ERR_ACCESS_DENIED') ||
                                   navError.message.includes('ERR_ACCESS_DENIED');

            if (isBlockingError) {
              logger.info(`[DISCOVERY_STAGE_2] Network-level blocking detected with minimal content (${navError.message}). Will attempt CAPTCHA detection and solving.`);
              discoveredNeedsCaptcha = true; // Mark that we detected blocking behavior
            }
          }
        } catch (contentError: any) {
          logger.warn(`[DISCOVERY_STAGE_2] Could not retrieve content after navigation error: ${contentError.message}`);
        }

        // If we don't have a page or browser after navigation error, we can't continue
        if (!page || !browser) {
          throw navigationError;
        }

        // If we still have a navigation error and no substantial content, we may need to handle it
        if (navigationError && (!htmlForAnalysis || htmlForAnalysis.length < 10000)) {
          // Continue anyway - we'll try to work with whatever we have
          logger.warn(`[DISCOVERY_STAGE_2] Navigation error with minimal content, but continuing with discovery attempt`);
        }
      }

      // Step 2: Get initial HTML content
      logger.info(`[DISCOVERY_STAGE_3] ===== INITIAL HTML CONTENT RETRIEVAL =====`);
      if (!htmlForAnalysis) {
        htmlForAnalysis = await this.puppeteerController.getPageContent(page);
        pageContentForError = htmlForAnalysis || '';
      }
      logger.info(`[DISCOVERY_STAGE_3] HTML content retrieved - Length: ${htmlForAnalysis?.length} chars`);
      logger.info(`[DISCOVERY_STAGE_3] Content preview: ${htmlForAnalysis?.substring(0, 200)}...`);

      // Step 3: Check for CAPTCHA and solve if needed
      logger.info(`[DISCOVERY_STAGE_4] ===== INITIAL CAPTCHA DETECTION =====`);
      if (htmlForAnalysis && this.htmlAnalyser.detectCaptchaMarkers(htmlForAnalysis)) {
        logger.info(`[DISCOVERY_STAGE_4] CAPTCHA detected in initial HTML, attempting to solve...`);
        const solved = await this.captchaSolver.solveIfPresent(page, url, userAgent);
        if (!solved) {
          logger.error(`[DISCOVERY_STAGE_4] CAPTCHA solving failed`);
          await this._saveDebugHtml('failure_captcha_solve', domain, url, pageContentForError);
          throw new CaptchaError('CAPTCHA solving failed during unified Puppeteer scraping.', { reason: 'captcha_solve_failed' });
        }
        discoveredNeedsCaptcha = true;
        htmlForAnalysis = await this.puppeteerController.getPageContent(page);
        pageContentForError = htmlForAnalysis;
        logger.info(`[DISCOVERY_STAGE_4] CAPTCHA solved successfully, fresh HTML retrieved - Length: ${htmlForAnalysis?.length} chars`);
      } else {
        logger.info(`[DISCOVERY_STAGE_4] No CAPTCHA detected in initial HTML`);
      }

      // Step 4: Perform interactions to load dynamic content
      logger.info(`[DISCOVERY_STAGE_5] ===== PAGE INTERACTIONS =====`);
      logger.info(`[DISCOVERY_STAGE_5] Performing page interactions to load dynamic content...`);
      await this.puppeteerController.performInteractions(page);
      const freshHtml = await this.puppeteerController.getPageContent(page);
      if (freshHtml) {
        const lengthBefore = htmlForAnalysis?.length || 0;
        htmlForAnalysis = freshHtml;
        pageContentForError = htmlForAnalysis;
        logger.info(`[DISCOVERY_STAGE_5] HTML updated after interactions - Before: ${lengthBefore} chars, After: ${htmlForAnalysis?.length} chars`);
        logger.info(`[DISCOVERY_STAGE_5] Content change: ${lengthBefore !== htmlForAnalysis?.length ? 'YES' : 'NO'}`);
      }

      // Step 5: Final CAPTCHA check after interactions
      logger.info(`[DISCOVERY_STAGE_6] ===== POST-INTERACTION CAPTCHA CHECK =====`);
      if (htmlForAnalysis && this.htmlAnalyser.detectCaptchaMarkers(htmlForAnalysis) && !discoveredNeedsCaptcha) {
        logger.info(`[DISCOVERY_STAGE_6] CAPTCHA detected after interactions, attempting to solve...`);
        const solved = await this.captchaSolver.solveIfPresent(page, url, userAgent);
        if (!solved) {
          logger.error(`[DISCOVERY_STAGE_6] Post-interaction CAPTCHA solving failed`);
          await this._saveDebugHtml('failure_captcha_post_interaction', domain, url, pageContentForError);
          throw new CaptchaError('CAPTCHA solving failed after interactions.', { reason: 'captcha_solve_failed_post_interaction' });
        }
        discoveredNeedsCaptcha = true;
        htmlForAnalysis = await this.puppeteerController.getPageContent(page);
        pageContentForError = htmlForAnalysis;
        logger.info(`[DISCOVERY_STAGE_6] Post-interaction CAPTCHA solved successfully`);
      } else if (!discoveredNeedsCaptcha) {
        logger.info(`[DISCOVERY_STAGE_6] No CAPTCHA detected after interactions`);
      } else {
        logger.info(`[DISCOVERY_STAGE_6] CAPTCHA already solved earlier, skipping check`);
      }

      logger.info(`[DISCOVERY_STAGE_7] ===== HTML CONTENT VALIDATION =====`);
      if (!htmlForAnalysis) {
        logger.error(`[DISCOVERY_STAGE_7] CRITICAL: No HTML content available for analysis`);
        await this._saveDebugHtml('failure_no_html', domain, url, pageContentForError || '');
        throw new NetworkError('Failed to retrieve HTML content for analysis.', { reason: 'no_html_content' });
      }
      logger.info(`[DISCOVERY_STAGE_7] HTML content validated - Length: ${htmlForAnalysis.length} chars`);

      // Step 6: LLM XPath Discovery
      logger.info(`[DISCOVERY_STAGE_8] ===== LLM XPATH DISCOVERY PREPARATION =====`);
      logger.info(`[DISCOVERY_STAGE_8] Extracting DOM structure for LLM analysis...`);
      const simplifiedDomForLlm = this.htmlAnalyser.extractDomStructure(htmlForAnalysis);
      if (!simplifiedDomForLlm) {
        logger.error(`[DISCOVERY_STAGE_8] CRITICAL: Failed to extract DOM structure`);
        await this._saveDebugHtml('failure_dom_extraction', domain, url, htmlForAnalysis);
        throw new ExtractionError('Failed to extract DOM structure', { reason: 'dom_structure_failed' });
      }
      logger.info(`[DISCOVERY_STAGE_8] DOM structure extracted - Length: ${simplifiedDomForLlm.length} chars`);

      logger.info(`[DISCOVERY_STAGE_8] Extracting article snippets for LLM context...`);
      const snippets = this.htmlAnalyser.extractArticleSnippets(htmlForAnalysis);
      if (!snippets) {
        logger.error(`[DISCOVERY_STAGE_8] CRITICAL: Failed to extract article snippets`);
        throw new ExtractionError('Failed to extract article snippets', { reason: 'snippets_failed' });
      }
      logger.info(`[DISCOVERY_STAGE_8] Article snippets extracted - Count: ${snippets.length}`);
      logger.info(`[DISCOVERY_STAGE_8] Snippet preview: ${snippets[0]?.substring(0, 100)}...`);

      let bestXPath: string | null = null;
      let bestScore = -Infinity;
      const llmFeedback: Array<{ xpath?: string; result?: string; message?: string } | string> = [];

      logger.info(`[DISCOVERY_STAGE_9] ===== LLM XPATH DISCOVERY ATTEMPTS =====`);
      logger.info(`[DISCOVERY_STAGE_9] Max LLM retries: ${this.configs.scraper.maxLlmRetries}`);
      logger.info(`[DISCOVERY_STAGE_9] Min XPath score threshold: ${this.configs.scraper.minXpathScoreThreshold}`);

      // LLM attempts
      for (let i = 0; i < this.configs.scraper.maxLlmRetries; i++) {
        logger.info(`[DISCOVERY_STAGE_9] === LLM ATTEMPT ${i + 1}/${this.configs.scraper.maxLlmRetries} ===`);
        const candidateXPaths = await this.llmInterface.getCandidateXPaths(simplifiedDomForLlm, snippets, llmFeedback);

        if (!candidateXPaths || candidateXPaths.length === 0) {
          logger.warn(`[DISCOVERY_STAGE_9] LLM returned no candidates on attempt ${i + 1}`);
          continue;
        }

        logger.info(`[DISCOVERY_STAGE_9] LLM returned ${candidateXPaths.length} candidate XPaths: ${JSON.stringify(candidateXPaths)}`);

        for (const xpath of candidateXPaths) {
          logger.info(`[DISCOVERY_STAGE_9] Testing XPath: ${xpath}`);
          try {
            const details = await this.puppeteerController.queryXPathWithDetails(page, xpath);
            if (details && details.element_found_count > 0) {
              const score = this.contentScoringEngine.scoreElement(details as ElementDetails);
              logger.info(`[DISCOVERY_STAGE_9] XPath "${xpath}" - Found: ${details.element_found_count} elements, Score: ${score.toFixed(2)}`);
              logger.info(`[DISCOVERY_STAGE_9] Element details - Tag: ${details.tagName}, Paragraphs: ${details.paragraphCount}, Text Length: ${details.textContentLength}`);
              if (score > bestScore) {
                bestScore = score;
                bestXPath = xpath;
                logger.info(`[DISCOVERY_STAGE_9] NEW BEST XPath: ${xpath} with score ${score.toFixed(2)}`);
              }
            } else {
              logger.info(`[DISCOVERY_STAGE_9] XPath "${xpath}" found 0 elements`);
            }
          } catch (queryError: any) {
            logger.warn(`[DISCOVERY_STAGE_9] Error querying XPath "${xpath}": ${queryError.message}`);
          }
        }

        logger.info(`[DISCOVERY_STAGE_9] Attempt ${i + 1} completed - Current best score: ${bestScore.toFixed(2)}, Best XPath: ${bestXPath || 'None'}`);
        if (bestScore >= this.configs.scraper.minXpathScoreThreshold) {
          logger.info(`[DISCOVERY_STAGE_9] Score threshold reached! Stopping LLM attempts.`);
          break;
        } else {
          logger.info(`[DISCOVERY_STAGE_9] Score ${bestScore.toFixed(2)} below threshold ${this.configs.scraper.minXpathScoreThreshold}, continuing...`);
        }
      }

      logger.info(`[DISCOVERY_STAGE_10] ===== XPATH DISCOVERY RESULTS =====`);
      if (!bestXPath || bestScore < this.configs.scraper.minXpathScoreThreshold) {
        logger.error(`[DISCOVERY_STAGE_10] CRITICAL: XPath discovery failed`);
        logger.error(`[DISCOVERY_STAGE_10] Best score achieved: ${bestScore.toFixed(2)}`);
        logger.error(`[DISCOVERY_STAGE_10] Required threshold: ${this.configs.scraper.minXpathScoreThreshold}`);
        logger.error(`[DISCOVERY_STAGE_10] Best XPath candidate: ${bestXPath || 'None'}`);
        await this._saveDebugHtml('failure_xpath_discovery', domain, url, htmlForAnalysis);
        throw new ExtractionError('XPath discovery failed or score too low.', { bestScore, reason: 'xpath_discovery_failed' });
      }

      logger.info(`[DISCOVERY_STAGE_10] XPath discovery SUCCESSFUL!`);
      logger.info(`[DISCOVERY_STAGE_10] Best XPath: ${bestXPath}`);
      logger.info(`[DISCOVERY_STAGE_10] Final score: ${bestScore.toFixed(2)}`);
      logger.info(`[DISCOVERY_STAGE_10] CAPTCHA required: ${discoveredNeedsCaptcha ? 'YES' : 'NO'}`);

      // Step 7: Save config and perform final scrape
      logger.info(`[DISCOVERY_STAGE_11] ===== CONFIG CREATION & STORAGE =====`);
      const methodToStore = discoveredNeedsCaptcha ? METHODS.PUPPETEER_CAPTCHA : METHODS.PUPPETEER_STEALTH;
      logger.info(`[DISCOVERY_STAGE_11] Method to store: ${methodToStore}`);

      const newConfig: SiteConfig = {
        domain_pattern: domain,
        method: methodToStore,
        xpath_main_content: bestXPath,
        last_successful_scrape_timestamp: new Date().toISOString(),
        failure_count_since_last_success: 0,
        site_specific_headers: null,
        needs_captcha_solver: discoveredNeedsCaptcha,
        puppeteer_wait_conditions: null,
        discovered_by_llm: true,
      };

      logger.info(`[DISCOVERY_STAGE_11] Saving new config for domain: ${domain}`);
      await this.knownSitesManager.saveConfig(domain, newConfig);
      logger.info(`[DISCOVERY_STAGE_11] Config saved successfully`);

      // Final scrape with discovered config
      logger.info(`[DISCOVERY_STAGE_12] ===== FINAL SCRAPE WITH DISCOVERED CONFIG =====`);
      const scrapeWithNewConfig = await this._scrapeWithKnownConfig(url, domain, newConfig, proxyDetails, userAgent, requestedOutput, browser, page);

      logger.info(`[DISCOVERY_STAGE_12] Final scrape completed successfully`);
      logger.info(`[DISCOVERY_STAGE_12] Content length: ${scrapeWithNewConfig.result?.data?.length || 0} chars`);
      return { result: scrapeWithNewConfig.result, browser: scrapeWithNewConfig.browser, page: scrapeWithNewConfig.page };

    } catch (error: any) {
      logger.error(`[DEBUG] Error in _unifiedPuppeteerScrape: ${error.message}`);
      if (pageContentForError.length > 0) {
        await this._saveDebugHtml('failure_unified_puppeteer', domain, url, pageContentForError);
      }
      throw error;
    }
  }


}

export { CoreScraperEngine };
