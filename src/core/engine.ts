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
import { fetchWithCurl, CurlResponse, ProxyDetails as CurlProxyDetails } from '../network/curl-handler.js';
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
    try {
        const elements = await page.$x(xpath);
        return elements;
    } catch (e: any) {
        logger.error(`[evaluateXPathQuery] Error using page.$x for xpath: ${xpath}. Error: ${e.message}`);
        logger.info(`[evaluateXPathQuery] Falling back to page.evaluateHandle for xpath: ${xpath}`);
        try {
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
            return children;
        } catch (evalError: any) {
            logger.error(`[evaluateXPathQuery] Error during fallback page.evaluateHandle for XPath: ${xpath}. Error: ${evalError.message}`);
            throw new ExtractionError(`Error evaluating XPath (both $x and evaluateHandle failed): ${xpath}`, { originalError: evalError });
        }
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
    type: 'success' | 'failure_curl_knowncfg' | 'failure_captcha_knowncfg' | 
          'failure_get_content_knowncfg' | 'failure_xpath_extract_knowncfg' | 
          'failure_generic_knowncfg' | 'failure_datadome_discovery' | 
          'failure_captcha_puppeteer_probe' | 'failure_no_html_for_analysis' | 
          'failure_captcha_post_interaction' | 'failure_dom_undefined' | 
          'failure_xpath_discovery' | 'success_discovery_phase' | 
          'failure_discover_scrape' | 'failure_captcha_no_fallback' |
          'failure_http_status_knowncfg',
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

  async scrape(targetUrl: string, proxyDetails: PuppeteerProxyDetails | CurlProxyDetails | null = null, userAgentString: string | null = null, requestedOutput: OutputTypeValue = OUTPUT_TYPES.CONTENT_ONLY as OutputTypeValue): Promise<ScrapeResult> {
    logger.debug(`[CoreScraperEngine SCRAPE_MAIN] Entry point. URL: ${targetUrl}, Output: ${requestedOutput}`);
    logger.info(`Starting scrape for URL: ${targetUrl}`);

    let browserGR: Browser | null = null; 
    let pageGR: Page | null = null;
    let domain: string | null = null;
    let siteConfig: SiteConfig | null = null;
    // Determine effectiveUserAgent once at the beginning
    const effectiveUserAgent = userAgentString || this.configs.scraper.defaultUserAgent;
    logger.debug(`[CoreScraperEngine SCRAPE_MAIN] Effective User-Agent: ${effectiveUserAgent}`);


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
                server: this.configs.scraper.httpProxy,
                username: proxyUrl.username ? decodeURIComponent(proxyUrl.username) : undefined,
                password: proxyUrl.password ? decodeURIComponent(proxyUrl.password) : undefined,
            };
        } catch (e: any) {
            logger.error(`[CoreScraperEngine SCRAPE_MAIN] Invalid HTTP_PROXY format: ${this.configs.scraper.httpProxy}. Error: ${e.message}`);
            throw new ConfigurationError(`Invalid HTTP_PROXY format: ${this.configs.scraper.httpProxy}`, { originalError: e.message });
        }
      }
      logger.debug(`[CoreScraperEngine SCRAPE_MAIN] Effective proxy: ${effectiveProxy ? JSON.stringify(effectiveProxy) : 'None'}`);

      try {
        siteConfig = await this.knownSitesManager.getConfig(domain);
      } catch (e: any) {
          logger.error(`[CoreScraperEngine SCRAPE_MAIN] Error getting site config for ${domain}: ${e.message}`);
          siteConfig = null;
      }
      logger.debug(`[CoreScraperEngine SCRAPE_MAIN] Site config from KnownSitesManager for ${domain}: ${siteConfig ? `Keys: ${Object.keys(siteConfig).join(', ')}` : 'Not found'}`);

      if (siteConfig) {
        logger.info(`Found known site config for domain: ${domain}`);
        logger.debug(`[CoreScraperEngine SCRAPE_MAIN] Attempting _scrapeWithKnownConfig for ${domain}`);
        try {
            const knownScrapeOutput = await this._scrapeWithKnownConfig(targetUrl, domain, siteConfig, effectiveProxy, effectiveUserAgent, requestedOutput, browserGR, pageGR);
            browserGR = knownScrapeOutput.browser; 
            pageGR = knownScrapeOutput.page;

            logger.debug(`[CoreScraperEngine SCRAPE_MAIN] _scrapeWithKnownConfig result: ${knownScrapeOutput.result !== null ? 'Success' : 'Failure (null)'}`);
            if (knownScrapeOutput.result && knownScrapeOutput.result.success) {
                logger.debug(`[CoreScraperEngine SCRAPE_MAIN] Known config scrape successful. Returning result.`);
                return knownScrapeOutput.result;
            }
            logger.warn(`Scraping with known config failed for ${domain}. Triggering re-discovery.`);
            await this.knownSitesManager.incrementFailure(domain);
        } catch (error: any) {
            logger.warn(`Error during _scrapeWithKnownConfig for ${domain}: ${error.message}. Triggering re-discovery.`);
            if (this.configs.scraper.debug) {
                logger.error(`[DEBUG_MODE] Full error during _scrapeWithKnownConfig for ${domain}:`, error);
            }
            await this.knownSitesManager.incrementFailure(domain);
        }
      }

      logger.info(`No known site config for domain: ${domain} or known config failed. Starting discovery.`);
      logger.debug(`[CoreScraperEngine SCRAPE_MAIN] Attempting _discoverAndScrape for ${domain}`);
      const discoveryOutput = await this._discoverAndScrape(targetUrl, domain, effectiveProxy, effectiveUserAgent, requestedOutput, browserGR, pageGR);
      browserGR = discoveryOutput.browser;
      pageGR = discoveryOutput.page;
      
      if (!discoveryOutput.result || !discoveryOutput.result.success) {
          throw new ScraperError("Discovery process failed to return a successful scrape result.", discoveryOutput.result?.details || { reason: "discovery_returned_failure" });
      }
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
    proxyDetails: PuppeteerProxyDetails | CurlProxyDetails | null, 
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
    const uaToUse = config.user_agent_to_use || userAgent; // Use site-specific UA if available, else the effective one

    try {
      logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Using method: ${config.method} with UA: ${uaToUse.substring(0,50)}...`);

      switch (config.method) {
        case METHODS.CURL:
          if (browser) { await this.puppeteerController.cleanupPuppeteer(browser); browser = null; page = null; }
          const curlResponse = await fetchWithCurl(url, proxyDetails as CurlProxyDetails | null, config.site_specific_headers, uaToUse);
          httpStatus = curlResponse.statusCode;
          pageContent = curlResponse.html || null;
          errorHtmlToSave = pageContent ? pageContent.substring(0, 50000) : '';
          if (!curlResponse.success || !pageContent || !(httpStatus && httpStatus >= 200 && httpStatus < 300 && httpStatus !== 304)) { // Allow 304
            logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] cURL fetch failed or got non-2xx/304 status. Status: ${httpStatus}, Error: ${curlResponse.error}`);
            await this._saveDebugHtml('failure_curl_knowncfg', config.domain_pattern, url, curlResponse.html || '');
            throw new NetworkError(`cURL fetch failed or got non-2xx/304 status for known config. Status: ${httpStatus}, Error: ${curlResponse.error}`, { reason: 'curl_fetch_failed_known_config', statusCode: httpStatus });
          }
          logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] cURL fetch successful. HTML length: ${pageContent?.length}`);
          break;
        case METHODS.PUPPETEER_STEALTH:
        case METHODS.PUPPETEER_CAPTCHA:
          logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Attempting Puppeteer (${config.method}) launch and navigate...`);
          let navigationResponse: HTTPResponse | null = null;
          if (!page || page.isClosed()) { 
            if (browser && browser.isConnected()) await this.puppeteerController.cleanupPuppeteer(browser);
            const navigateResult = await this.puppeteerController.launchAndNavigate(url, proxyDetails as PuppeteerProxyDetails | null, uaToUse, config.puppeteer_wait_conditions);
            browser = navigateResult.browser; page = navigateResult.page;
            // Try to get the response from the last navigation in launchAndNavigate
            navigationResponse = page.mainFrame().childFrames().length > 0 ? await page.mainFrame().childFrames()[0].goto(page.url()) : await page.goto(page.url()); // Re-navigate to get response, can be risky
          } else { 
             navigationResponse = await this.puppeteerController.navigate(page, url, config.puppeteer_wait_conditions);
          }
          httpStatus = navigationResponse?.status();
          pageContent = await this.puppeteerController.getPageContent(page!); 
          errorHtmlToSave = pageContent ? pageContent.substring(0, 50000) : '';
          logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Puppeteer navigation/content fetch completed. Status: ${httpStatus}, Content Length: ${pageContent?.length}`);

          // If non-2xx status or very small content (indicative of block/CAPTCHA page)
          // Also check if the method is not already puppeteer_captcha, to avoid infinite loops if captcha solving itself leads to a block.
          if (page && pageContent && 
              ((httpStatus && (httpStatus < 200 || httpStatus >= 300) && httpStatus !== 304) || (pageContent.length < 2000)) && 
              this.htmlAnalyser.detectCaptchaMarkers(pageContent) && 
              config.method !== METHODS.PUPPETEER_CAPTCHA) { // Added check to prevent re-solving if already P_CAPTCHA
            logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] Puppeteer got non-2xx status (${httpStatus}) or potential block page. Checking for CAPTCHA.`);
            logger.info(`[CoreScraperEngine _scrapeWithKnownConfig] CAPTCHA detected on page (status ${httpStatus}). Attempting solve.`);
            const captchaSolved = await this.captchaSolver.solveIfPresent(page, url, uaToUse); // Pass uaToUse
            if (captchaSolved) {
              logger.info(`[CoreScraperEngine _scrapeWithKnownConfig] CAPTCHA solved. Re-fetching content.`);
              pageContent = await this.puppeteerController.getPageContent(page);
              errorHtmlToSave = pageContent ? pageContent.substring(0, 50000) : '';
              const newResponse = await page.goto(page.url(), { waitUntil: 'networkidle0' }).catch(() => null); // Try to get a new response
              httpStatus = newResponse?.status() || httpStatus; 
              logger.debug(`[CoreScraperEngine _scrapeWithKnownConfig] Content re-fetched after CAPTCHA. New Status: ${httpStatus}, Length: ${pageContent?.length}`);
              if (!config.needs_captcha_solver || config.method !== METHODS.PUPPETEER_CAPTCHA) {
                  needsConfigUpdate = true; 
              }
            } else {
              logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] CAPTCHA detected but solving failed.`);
              await this._saveDebugHtml('failure_captcha_knowncfg', config.domain_pattern, url, pageContent || '');
              throw new CaptchaError('CAPTCHA solving failed after non-2xx/block page.', { reason: 'captcha_solve_failed_on_block_page' });
            }
          } else if (httpStatus && (httpStatus < 200 || httpStatus >= 300) && httpStatus !== 304) {
            // Non-2xx status and NO CAPTCHA detected (or method was already PUPPETEER_CAPTCHA and it still failed)
            logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] Page loaded with non-2xx status: ${httpStatus}. Content might be an error page.`);
            await this._saveDebugHtml('failure_http_status_knowncfg', config.domain_pattern, url, pageContent);
            throw new NetworkError(`Page loaded with status ${httpStatus} for known config.`, { statusCode: httpStatus, reason: 'non_2xx_known_config' });
          }
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
      if (config.method === METHODS.CURL) {
        extractedElementHtml = this.htmlAnalyser.extractByXpath(pageContent, config.xpath_main_content);
      } else if (page) {
          const elements: ElementHandle<Node>[] = await evaluateXPathQuery(page, config.xpath_main_content);
          if (elements.length > 0) {
              extractedElementHtml = await page.evaluate(elNode => (elNode && elNode.nodeType === Node.ELEMENT_NODE) ? (elNode as Element).innerHTML : null, elements[0]);
              for (const el of elements) await el.dispose();
          } else {
              logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] XPath matched 0 elements in Puppeteer for XPath: ${config.xpath_main_content}`);
          }
      }

      if (!extractedElementHtml) {
        logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] Known XPath "${config.xpath_main_content}" did not yield content for ${url}.`);
        await this._saveDebugHtml('failure_xpath_extract_knowncfg', config.domain_pattern, url, pageContent);
        
        // If XPath failed, and we are using Puppeteer, check for CAPTCHA one last time
        if (page && pageContent && this.htmlAnalyser.detectCaptchaMarkers(pageContent) && config.method !== METHODS.PUPPETEER_CAPTCHA) {
            logger.info(`[CoreScraperEngine _scrapeWithKnownConfig] CAPTCHA detected after known XPath failed for ${url}. Attempting CAPTCHA solve.`);
            const captchaSolved = await this.captchaSolver.solveIfPresent(page, url, uaToUse);
            if (captchaSolved) {
                logger.info(`[CoreScraperEngine _scrapeWithKnownConfig] CAPTCHA solved. Re-fetching content and re-trying XPath.`);
                pageContent = await this.puppeteerController.getPageContent(page);
                errorHtmlToSave = pageContent ? pageContent.substring(0, 50000) : ''; // Update errorHtmlToSave
                const elements: ElementHandle<Node>[] = await evaluateXPathQuery(page, config.xpath_main_content);
                if (elements.length > 0) {
                    extractedElementHtml = await page.evaluate(elNode => (elNode && elNode.nodeType === Node.ELEMENT_NODE) ? (elNode as Element).innerHTML : null, elements[0]);
                    for (const el of elements) await el.dispose();
                }
                if (extractedElementHtml) {
                    logger.info(`[CoreScraperEngine _scrapeWithKnownConfig] Content successfully extracted with known XPath after CAPTCHA solve (post-XPath-fail) for ${url}.`);
                    needsConfigUpdate = true; 
                } else {
                    logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] Known XPath still failed after CAPTCHA solve (post-XPath-fail) for ${url}.`);
                }
            } else {
                 logger.warn(`[CoreScraperEngine _scrapeWithKnownConfig] CAPTCHA detected (post-XPath-fail) and solving failed for ${url}.`);
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

  private async _discoverAndScrape(
    url: string, 
    domain: string, 
    proxyDetails: PuppeteerProxyDetails | CurlProxyDetails | null, 
    userAgent: string, // This is the effectiveUserAgent
    requestedOutput: OutputTypeValue,
    browserIn: Browser | null,
    pageIn: Page | null
  ): Promise<{ result: ScrapeResult, browser: Browser | null, page: Page | null }> {
    logger.debug(`[CoreScraperEngine _discoverAndScrape] Entry. URL: ${url}, Domain: ${domain}`);
    let browser: Browser | null = browserIn;
    let page: Page | null = pageIn;
    let curlHtml: string | null = null;
    let puppeteerHtml: string | null = null;
    let htmlForAnalysis: string | null = null;
    let tentativeMethodIsCurl = false;
    let discoveredNeedsCaptcha = false; // Tracks if a CAPTCHA was encountered AND solved by our solver
    let pageContentForError: string = '';
    let finalScrapeResult: ScrapeResult | null = null;

    try {
      logger.debug(`[CoreScraperEngine _discoverAndScrape] Step 1: Initial Probing... UA: ${userAgent.substring(0,50)}...`);
      
      const curlResponse: CurlResponse = await fetchWithCurl(url, proxyDetails as CurlProxyDetails | null, null, userAgent).catch(e => {
        logger.warn(`[CoreScraperEngine _discoverAndScrape] cURL fetch raw error: ${e.message}`);
        return { success: false, error: e.message, html: (e.details as any)?.htmlContent || '', statusCode: (e.details as any)?.statusCode };
      });
      pageContentForError = curlResponse.html || '';

      let curlHtmlIsUsable = false;
      if (curlResponse.success && curlResponse.html && curlResponse.statusCode && curlResponse.statusCode >= 200 && curlResponse.statusCode < 300) {
        curlHtml = curlResponse.html;
        if (!this.htmlAnalyser.detectCaptchaMarkers(curlHtml)) {
          curlHtmlIsUsable = true;
          htmlForAnalysis = curlHtml;
          tentativeMethodIsCurl = true;
          logger.debug(`[CoreScraperEngine _discoverAndScrape] cURL fetch successful and no CAPTCHA. Tentatively using cURL HTML.`);
        } else {
          logger.info('[CoreScraperEngine _discoverAndScrape] CAPTCHA detected in cURL response. cURL HTML is not immediately usable.');
        }
      } else {
        logger.warn(`[CoreScraperEngine _discoverAndScrape] cURL fetch failed, returned no HTML, or got non-2xx status: ${curlResponse?.error || 'Unknown cURL issue'}, Status: ${curlResponse?.statusCode}`);
      }

      if (!curlHtmlIsUsable) {
        logger.info(`[CoreScraperEngine _discoverAndScrape] cURL HTML not usable or CAPTCHA detected. Proceeding with Puppeteer probe.`);
        tentativeMethodIsCurl = false; 
        
        let puppeteerNavSucceeded = false;
        try {
            if (!page || page.isClosed()) { 
                if (browser && browser.isConnected()) await this.puppeteerController.cleanupPuppeteer(browser);
                const navigateResult = await this.puppeteerController.launchAndNavigate(url, proxyDetails as PuppeteerProxyDetails | null, userAgent, null, true);
                browser = navigateResult.browser;
                page = navigateResult.page;
            } else { 
                 await this.puppeteerController.navigate(page, url, null, true);
            }
            puppeteerNavSucceeded = true;
        } catch (navError: any) {
            logger.warn(`[CoreScraperEngine _discoverAndScrape] Puppeteer navigation failed during initial probe: ${navError.message}`);
            pageContentForError = navError.details?.htmlContent || pageContentForError; 
            if (!curlHtmlIsUsable) { 
                await this._saveDebugHtml('failure_no_html_for_analysis', domain, url, pageContentForError);
                throw new NetworkError('Both cURL and Puppeteer probes failed to get usable page for discovery.', { originalError: navError });
            }
            if (curlHtml && this.htmlAnalyser.detectCaptchaMarkers(curlHtml)) {
                 await this._saveDebugHtml('failure_captcha_no_fallback', domain, url, curlHtml);
                 throw new CaptchaError('cURL HTML unusable due to CAPTCHA and Puppeteer probe also failed to navigate.', { originalError: navError });
            }
        }

        if (puppeteerNavSucceeded && page) {
            puppeteerHtml = await this.puppeteerController.getPageContent(page);
            pageContentForError = puppeteerHtml || pageContentForError;

            if (this.htmlAnalyser.detectCaptchaMarkers(puppeteerHtml)) {
              logger.info('[CoreScraperEngine _discoverAndScrape] CAPTCHA detected in Puppeteer probe response.');
              const solved = await this.captchaSolver.solveIfPresent(page, url, userAgent); // Pass userAgent
              if (!solved) {
                await this._saveDebugHtml('failure_captcha_puppeteer_probe', domain, url, pageContentForError);
                throw new CaptchaError('CAPTCHA solving failed during Puppeteer probe.', { reason: 'captcha_solve_failed_puppeteer_probe' });
              }
              discoveredNeedsCaptcha = true; // CAPTCHA was present and solved
              puppeteerHtml = await this.puppeteerController.getPageContent(page); 
              logger.debug(`[CoreScraperEngine _discoverAndScrape] Puppeteer HTML after CAPTCHA solve. Length: ${puppeteerHtml?.length}`);
            }
            htmlForAnalysis = puppeteerHtml;
        }
      }
      
      if (!htmlForAnalysis) {
        logger.error(`[CoreScraperEngine _discoverAndScrape] CRITICAL: Failed to retrieve any HTML content for analysis after all probes.`);
        await this._saveDebugHtml('failure_no_html_for_analysis', domain, url, pageContentForError || '');
        throw new NetworkError('Failed to retrieve any HTML content for analysis after all probes (final check).', { reason: 'no_html_for_analysis_final' });
      }
      pageContentForError = htmlForAnalysis; 

      logger.debug(`[CoreScraperEngine _discoverAndScrape] HTML for analysis chosen. Length: ${htmlForAnalysis?.length}. Tentative method is cURL: ${tentativeMethodIsCurl}. Needs CAPTCHA (solved): ${discoveredNeedsCaptcha}`);
      
      // If cURL was initially clean, and we want to compare with Puppeteer (if Puppeteer also ran and got clean HTML)
      if (curlHtmlIsUsable && puppeteerHtml && !this.htmlAnalyser.detectCaptchaMarkers(puppeteerHtml) && !discoveredNeedsCaptcha) {
        logger.debug(`[CoreScraperEngine _discoverAndScrape] Both cURL and Puppeteer HTML (clean) are available. Comparing DOMs...`);
        const areSimilar = await this.domComparator.compareDoms(curlHtml, puppeteerHtml); // curlHtml is from initial usable fetch
        if (areSimilar) {
            logger.info('[CoreScraperEngine _discoverAndScrape] DOMs similar. Preferring cURL HTML for analysis.');
            htmlForAnalysis = curlHtml; // Re-affirm
            tentativeMethodIsCurl = true;
            // Close the Puppeteer instance if it was opened just for this comparison/discovery path
            if (page && !page.isClosed() && browser) { await this.puppeteerController.cleanupPuppeteer(browser); browser = null; page = null; }
        } else {
            logger.info(`[CoreScraperEngine _discoverAndScrape] DOMs differ. Using Puppeteer HTML for analysis.`);
            htmlForAnalysis = puppeteerHtml; 
            tentativeMethodIsCurl = false; // We are now committed to Puppeteer's version
        }
      }
      
      if (!tentativeMethodIsCurl && page && !page.isClosed()) {
        logger.debug('[CoreScraperEngine _discoverAndScrape] Performing full interactions on Puppeteer page for discovery.');
        await this.puppeteerController.performInteractions(page);
        const freshPuppeteerHtml = await this.puppeteerController.getPageContent(page);
        if (freshPuppeteerHtml) {
            logger.debug(`[CoreScraperEngine _discoverAndScrape] HTML after interactions. Length: ${freshPuppeteerHtml?.length}. Updating htmlForAnalysis.`);
            htmlForAnalysis = freshPuppeteerHtml;
            pageContentForError = htmlForAnalysis;
        }
        // Re-check CAPTCHA after interactions, only if not already handled
        if (this.htmlAnalyser.detectCaptchaMarkers(htmlForAnalysis) && !discoveredNeedsCaptcha) {
            logger.info('[CoreScraperEngine _discoverAndScrape] CAPTCHA detected after full Puppeteer load and interactions. Attempting solve.');
            const solved = await this.captchaSolver.solveIfPresent(page, url, userAgent); // Pass userAgent
            if (!solved) {
                await this._saveDebugHtml('failure_captcha_post_interaction', domain, url, pageContentForError);
                throw new CaptchaError('CAPTCHA solving failed after full load and interactions.',{ reason: 'captcha_solve_failed_post_interaction' });
            }
            discoveredNeedsCaptcha = true; // Mark that CAPTCHA was solved
            htmlForAnalysis = await this.puppeteerController.getPageContent(page);
            pageContentForError = htmlForAnalysis;
            logger.debug(`[CoreScraperEngine _discoverAndScrape] HTML after post-interaction CAPTCHA solve. Length: ${htmlForAnalysis?.length}`);
        }
      }

      logger.debug(`[CoreScraperEngine _discoverAndScrape] Step 3: LLM XPath Discovery...`);
      logger.info('Preparing simplified DOM for LLM...');
      const simplifiedDomForLlm = this.htmlAnalyser.extractDomStructure(htmlForAnalysis);
      if (!simplifiedDomForLlm && htmlForAnalysis) {
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

      let bestXPath: string | null = null;
      let bestScore = -Infinity;
      const llmFeedback: Array<{ xpath?: string; result?: string; message?: string } | string> = [];

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
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        let foundXPathInAttempt: string | null = null;
        let bestScoreInAttempt = -Infinity;
        const attemptFeedback: Array<{ xpath: string; result: string }> = [];

        for (const xpath of candidateXPaths) {
          logger.debug(`[CoreScraperEngine _discoverAndScrape] Scoring XPath: ${xpath}`);
          let details: ElementDetails | XPathQueryDetails;
          try {
            if (tentativeMethodIsCurl) { // If analysis is based on cURL HTML
                details = this.htmlAnalyser.queryStaticXPathWithDetails(htmlForAnalysis, xpath);
            } else if (page) { // If analysis is based on Puppeteer HTML, page must be valid
                details = await this.puppeteerController.queryXPathWithDetails(page, xpath);
            } else {
                logger.error("[CoreScraperEngine _discoverAndScrape] Page object is unexpectedly null in Puppeteer mode for XPath scoring during discovery.");
                throw new Error("Page object is not available for XPath querying in Puppeteer mode but tentativeMethodIsCurl is false.");
            }
          } catch (queryError: any) {
            logger.warn(`[CoreScraperEngine _discoverAndScrape] Error querying XPath "${xpath}": ${queryError.message}`);
            attemptFeedback.push({ xpath, result: `Error querying: ${queryError.message.substring(0,50)}`});
            continue;
          }

          if (details && details.element_found_count !== undefined && details.element_found_count > 0) {
            logger.debug(`[CoreScraperEngine _discoverAndScrape] Details for XPath "${xpath}": found_count=${details.element_found_count}, tagName=${details.tagName}, pCount=${details.paragraphCount}, textLen=${details.textContentLength}`);
            const score = this.contentScoringEngine.scoreElement(details as ElementDetails);
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
            .sort((a,b) => parseFloat(b.result.match(/Score (-?\d+\.?\d*)/)?.[1] || '-Infinity') - parseFloat(a.result.match(/Score (-?\d+\.?\d*)/)?.[1] || '-Infinity') )
            .slice(0,5));
        logger.debug(`[CoreScraperEngine _discoverAndScrape] Feedback for next LLM attempt:`, llmFeedback);

        if (bestScore >= this.configs.scraper.minXpathScoreThreshold) {
          logger.info(`[CoreScraperEngine _discoverAndScrape] Sufficiently good XPath found with score ${bestScore.toFixed(2)}. Stopping LLM attempts.`);
          break;
        }
        if (i < this.configs.scraper.maxLlmRetries - 1) {
            logger.info(`[CoreScraperEngine _discoverAndScrape] Current best score ${bestScore.toFixed(2)} is below threshold ${this.configs.scraper.minXpathScoreThreshold}. Retrying with feedback.`);
            await new Promise(resolve => setTimeout(resolve, 1500));
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
      let methodToStore: MethodValue;
      if (discoveredNeedsCaptcha) { // If a CAPTCHA was successfully solved by our system during Puppeteer interaction
        methodToStore = METHODS.PUPPETEER_CAPTCHA;
        logger.debug(`[CoreScraperEngine _discoverAndScrape] Method to store: PUPPETEER_CAPTCHA (CAPTCHA was solved).`);
      } else if (curlHtmlIsUsable && puppeteerHtml && !this.htmlAnalyser.detectCaptchaMarkers(puppeteerHtml)) {
        // Both cURL and Puppeteer (clean) HTML are available. Compare them.
        const areSimilar = await this.domComparator.compareDoms(curlHtml, puppeteerHtml);
        if (areSimilar) {
            const curlValidationContent = this.htmlAnalyser.extractByXpath(curlHtml, foundXPath);
            if (curlValidationContent) {
                methodToStore = METHODS.CURL;
                logger.info(`[CoreScraperEngine _discoverAndScrape] cURL and Puppeteer DOMs similar, XPath works on cURL. Storing as CURL.`);
                if (page && !page.isClosed() && browser) { await this.puppeteerController.cleanupPuppeteer(browser); browser = null; page = null; }
            } else {
                methodToStore = METHODS.PUPPETEER_STEALTH; // XPath didn't work on cURL, default to Puppeteer
                logger.warn(`[CoreScraperEngine _discoverAndScrape] DOMs similar, but XPath failed on cURL. Storing as PUPPETEER_STEALTH.`);
            }
        } else {
            methodToStore = METHODS.PUPPETEER_STEALTH; // DOMs different, prefer Puppeteer
            logger.info(`[CoreScraperEngine _discoverAndScrape] cURL and Puppeteer DOMs differ. Storing as PUPPETEER_STEALTH.`);
        }
      } else if (curlHtmlIsUsable) { // Only cURL was usable (Puppeteer failed or wasn't run for comparison)
        const curlValidationContent = this.htmlAnalyser.extractByXpath(curlHtml, foundXPath);
        if (curlValidationContent) {
            methodToStore = METHODS.CURL;
            logger.info(`[CoreScraperEngine _discoverAndScrape] Only cURL HTML was usable, XPath works. Storing as CURL.`);
        } else {
            // This is a tricky case: LLM found XPath on cURL HTML, but it doesn't re-validate.
            // This implies an issue with XPath or LLM.
            logger.error(`[CoreScraperEngine _discoverAndScrape] XPath found on cURL HTML, but failed re-validation. Discovery failed.`);
            throw new ExtractionError("XPath from cURL HTML failed re-validation.", {xpath: foundXPath});
        }
      } else { // Only Puppeteer HTML was usable (or cURL was unusable and Puppeteer was the only option)
        methodToStore = discoveredNeedsCaptcha ? METHODS.PUPPETEER_CAPTCHA : METHODS.PUPPETEER_STEALTH;
        logger.debug(`[CoreScraperEngine _discoverAndScrape] Defaulting to Puppeteer method: ${methodToStore} (cURL not viable or not chosen after comparison).`);
      }


      const newConfig: SiteConfig = {
        domain_pattern: domain,
        method: methodToStore,
        xpath_main_content: foundXPath,
        last_successful_scrape_timestamp: new Date().toISOString(),
        failure_count_since_last_success: 0,
        site_specific_headers: null,
        user_agent_to_use: userAgent, // Use the effectiveUserAgent that led to successful discovery
        needs_captcha_solver: discoveredNeedsCaptcha, 
        puppeteer_wait_conditions: null,
        discovered_by_llm: true,
      };
      logger.debug(`[CoreScraperEngine _discoverAndScrape] New config to save for ${domain}:`, newConfig);
      await this.knownSitesManager.saveConfig(domain, newConfig);
      logger.info(`New config saved for ${domain}. Method: ${methodToStore}, XPath: ${foundXPath}`);

      logger.debug(`[CoreScraperEngine _discoverAndScrape] Step 5: Scrape with newly discovered config...`);
      await this._saveDebugHtml('success_discovery_phase', domain, url, htmlForAnalysis);

      const scrapeWithNewConfig = await this._scrapeWithKnownConfig(url, domain, newConfig, proxyDetails, userAgent, requestedOutput, browser, page);
      browser = scrapeWithNewConfig.browser; 
      page = scrapeWithNewConfig.page;

      if (!scrapeWithNewConfig.result || !scrapeWithNewConfig.result.success) {
          logger.error(`[CoreScraperEngine _discoverAndScrape] Scraping with newly discovered config FAILED unexpectedly.`);
          throw new ExtractionError("Scraping with newly discovered config failed unexpectedly.", { reason: 'scrape_with_new_config_failed' });
      }
      logger.debug(`[CoreScraperEngine _discoverAndScrape] Final result from scraping with new config obtained successfully.`);
      finalScrapeResult = scrapeWithNewConfig.result;
      return { result: finalScrapeResult, browser, page };

    } catch (error: any) {
      logger.error(`[CoreScraperEngine _discoverAndScrape] ${error.name || 'Error'} during discovery/scrape for ${url}: ${error.message}`);
      if (this.configs.scraper.debug) {
        logger.error(`[DEBUG_MODE] Full error in _discoverAndScrape for ${url}:`, error);
      }
      if (error.details) logger.error(`[CoreScraperEngine _discoverAndScrape] Error details:`, error.details);

      const finalErrorHtmlContent = pageContentForError || (htmlForAnalysis ? htmlForAnalysis.substring(0,50000) : '');
      logger.debug(`[CoreScraperEngine _discoverAndScrape] HTML content at time of error (length: ${finalErrorHtmlContent?.length}): ${finalErrorHtmlContent ? finalErrorHtmlContent.substring(0, 200) + '...' : 'N/A'}`);
      if (finalErrorHtmlContent.length > 0) {
        await this._saveDebugHtml('failure_discover_scrape', domain, url, finalErrorHtmlContent);
      }
      throw error; 
    }
  }
}

export { CoreScraperEngine };
