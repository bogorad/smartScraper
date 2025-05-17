#!/bin/sh
# This is a shell archive (shar)
# To extract, save this file as apply_changes_v3.shar and run:
#   bash apply_changes_v3.shar
#
# This script will overwrite existing files. Backup your project first!
# After applying, manually delete 'analysis/html-analyser.js'.

echo "Creating core/engine.js"
mkdir -p ./core
cat << 'EOF' > ./core/engine.js
// src/core/engine.js
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url'; // For robust URL parsing, especially for filenames

import { KnownSitesManager } from '../storage/known-sites-manager.js';
import { PuppeteerController } from '../browser/puppeteer-controller.js';
// import { HtmlAnalyser } from '../analysis/html-analyser.js'; // OLD
import { HtmlAnalyserFixed as HtmlAnalyser } from '../analysis/html-analyser-fixed.js'; // SWITCHED
import { DomComparator } from '../analysis/dom-comparator.js';
import { LLMInterface } from '../services/llm-interface.js';
import { ContentScoringEngine } from '../analysis/content-scoring-engine.js';
import { CaptchaSolver } from '../services/captcha-solver.js';
import { PluginManager } from '../browser/plugin-manager.js';
import { fetchWithCurl } from '../network/curl-handler.js';
import { logger } from '../utils/logger.js';
import { normalizeDomain } from '../utils/url-helpers.js';
import {
  ScraperError,
  LLMError,
  CaptchaError,
  NetworkError,
  ConfigurationError,
  ExtractionError
} from '../utils/error-handler.js';
import { scraperSettings as defaultConfigScraper, llmConfig as defaultConfigLlm, captchaSolverConfig as defaultConfigCaptcha } from '../../config/index.js';
import { METHODS, OUTPUT_TYPES, DEFAULT_USER_AGENT } from '../constants.js';


class CoreScraperEngine {
  constructor(configs = {}) {
    this.configs = {
      scraper: { ...defaultConfigScraper, ...configs.scraperSettings },
      llm: { ...defaultConfigLlm, ...configs.llmConfig },
      captchaSolver: { ...defaultConfigCaptcha, ...configs.captchaSolverConfig }
    };

    this.knownSitesManager = new KnownSitesManager(this.configs.scraper.knownSitesStoragePath);
    this.pluginManager = new PluginManager();
    this.puppeteerController = new PuppeteerController(this.pluginManager, this.configs.scraper);
    this.htmlAnalyser = new HtmlAnalyser(); // Now refers to HtmlAnalyserFixed
    this.domComparator = new DomComparator(this.configs.scraper.domComparisonThreshold);
    this.contentScoringEngine = new ContentScoringEngine(
      this.configs.scraper.scoreWeights,
      this.configs.scraper.minParagraphThreshold,
      this.configs.scraper.tagsToCount,
      this.configs.scraper.unwantedTags,
      this.configs.scraper.descriptiveIdOrClassKeywords
    );
    this.llmInterface = new LLMInterface(this.configs.llm);
    this.captchaSolver = new CaptchaSolver(this.configs.captchaSolver, this.knownSitesManager);

    logger.info('CoreScraperEngine initialized with HtmlAnalyserFixed (as HtmlAnalyser).');
  }

  async _saveDebugHtml(type, domain, urlString, htmlContent) {
    if (!this.configs.scraper.debug || typeof htmlContent !== 'string' || !htmlContent.trim()) {
        if (this.configs.scraper.debug && (typeof htmlContent !== 'string' || !htmlContent.trim())) {
            logger.debug(`[DEBUG] Not saving HTML for ${urlString}: HTML content is empty or not a string.`);
        }
        return;
    }

    let dumpDir;
    if (type === 'failure') {
      dumpDir = this.configs.scraper.failedHtmlDumpsPath;
    } else if (type === 'success' && this.configs.scraper.saveHtmlOnSuccessNav) {
      dumpDir = this.configs.scraper.successHtmlDumpsPath;
    } else {
      logger.debug(`[DEBUG] Conditions not met to save HTML for ${urlString}. Type: ${type}, SaveOnSuccess: ${this.configs.scraper.saveHtmlOnSuccessNav}`);
      return; 
    }

    try {
      await fs.mkdir(dumpDir, { recursive: true });
      const parsedUrl = new URL(urlString);
      const safePathname = (parsedUrl.pathname === '/' ? '_root' : parsedUrl.pathname)
                            .replace(/[^a-zA-Z0-9_.-]/g, '_').substring(0, 100);
      const safeHostname = parsedUrl.hostname.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const filename = `${safeHostname}${safePathname}_${type}_${Date.now()}.html`;
      
      const filePath = path.join(dumpDir, filename);
      await fs.writeFile(filePath, htmlContent);
      logger.info(`[DEBUG] Saved ${type} HTML to ${filePath} for URL: ${urlString}`);
    } catch (saveError) {
      logger.warn(`[DEBUG] Failed to save ${type} HTML for ${urlString}: ${saveError.message}`);
    }
  }

  async scrape(targetUrl, proxyDetails = null, userAgentString = null, requestedOutput = OUTPUT_TYPES.CONTENT_ONLY) {
    logger.info(`Starting scrape for URL: ${targetUrl}`);
    const domain = normalizeDomain(targetUrl);
    let htmlToSaveOnError = null; 

    if (!domain) {
      const errorMsg = `Invalid URL or unable to extract domain: ${targetUrl}`;
      logger.error(errorMsg);
      throw new ConfigurationError(errorMsg, { url: targetUrl });
    }
    
    const effectiveUserAgent = userAgentString || DEFAULT_USER_AGENT;
    let effectiveProxy = proxyDetails;
    if (!effectiveProxy && process.env.HTTP_PROXY) {
        effectiveProxy = { server: process.env.HTTP_PROXY }; 
        logger.info(`Using default proxy from HTTP_PROXY environment variable for ${targetUrl}`);
    }

    try {
      let siteConfig = await this.knownSitesManager.getConfig(domain);

      if (siteConfig) {
        logger.info(`Found known site config for domain: ${domain}`);
        const knownScrapeResult = await this._scrapeWithKnownConfig(targetUrl, siteConfig, effectiveProxy, effectiveUserAgent, requestedOutput);
        if (knownScrapeResult.success) {
          return knownScrapeResult;
        }
        logger.warn(`Scraping with known config failed for ${domain}. Triggering re-discovery.`);
        await this.knownSitesManager.incrementFailure(domain);
        htmlToSaveOnError = knownScrapeResult.htmlContent || null;
      } else {
        logger.info(`No known site config for domain: ${domain}. Starting discovery.`);
      }

      // Pass undefined for oldConfigHint as it's removed
      const discoveryResult = await this._discoverAndScrape(targetUrl, domain, effectiveProxy, effectiveUserAgent, requestedOutput);
      return discoveryResult;

    } catch (error) {
      logger.error(`${error.name || 'Error'} during main scrape for ${targetUrl}: ${error.message}`, error.details || error.stack);
      const errorHtml = htmlToSaveOnError || (error.details?.htmlContent) || (error.htmlContent) || '';
      await this._saveDebugHtml('failure', domain, targetUrl, errorHtml);
      if (error instanceof ScraperError) throw error;
      throw new ScraperError(`Scraping failed for ${targetUrl}: ${error.message}`, { originalError: error, htmlContent: errorHtml });
    }
  }

  async _scrapeWithKnownConfig(url, config, proxyDetails, userAgent, requestedOutput) {
    logger.info(`Attempting scrape with known config for: ${url} using method: ${config.method}`);
    let browser = null;
    let page = null;
    let pageContent = null;

    try {
      switch (config.method) {
        case METHODS.CURL:
          const curlResponse = await fetchWithCurl(url, proxyDetails, config.site_specific_headers, userAgent);
          pageContent = curlResponse.html;
          if (!curlResponse.success || !pageContent) {
            throw new NetworkError(`cURL fetch failed for known config: ${curlResponse.error}`, { htmlContent: pageContent });
          }
          break;
        case METHODS.PUPPETEER_STEALTH:
        case METHODS.PUPPETEER_CAPTCHA:
          ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, userAgent, config.puppeteer_wait_conditions));
          
          if (config.method === METHODS.PUPPETEER_CAPTCHA || config.needs_captcha_solver) {
            const captchaSolved = await this.captchaSolver.solveIfPresent(page, url);
            if (!captchaSolved) {
              pageContent = await this.puppeteerController.getPageContent(page).catch(() => null);
              throw new CaptchaError('CAPTCHA solving failed or CAPTCHA not found as expected for known config.', { htmlContent: pageContent });
            }
            await page.waitForTimeout(this.configs.scraper.puppeteerPostLoadDelay);
          }
          pageContent = await this.puppeteerController.getPageContent(page);
          break;
        default:
          throw new ConfigurationError(`Unknown method in site config: ${config.method}`);
      }

      if (!pageContent) {
        throw new ExtractionError('Failed to retrieve page content with known config.', { htmlContent: pageContent });
      }

      if (requestedOutput === OUTPUT_TYPES.FULL_HTML) {
        await this.knownSitesManager.updateSuccess(config.domain_pattern);
        await this._saveDebugHtml('success', config.domain_pattern, url, pageContent);
        return { success: true, data: pageContent, method: config.method, xpath: config.xpath_main_content, htmlContent: pageContent };
      }

      let extractedElementHtml = null;
      if (page) { 
        const elements = await page.$x(config.xpath_main_content);
        if (elements.length > 0) {
          extractedElementHtml = await page.evaluate(el => el.innerHTML, elements[0]);
          for (const el of elements) await el.dispose(); // Dispose all handles
        }
      } else { 
        extractedElementHtml = this.htmlAnalyser.extractByXpath(pageContent, config.xpath_main_content);
      }

      if (!extractedElementHtml) {
        throw new ExtractionError(`XPath ${config.xpath_main_content} did not yield content with known config.`, { htmlContent: pageContent });
      }

      await this.knownSitesManager.updateSuccess(config.domain_pattern);
      await this._saveDebugHtml('success', config.domain_pattern, url, pageContent);
      return { success: true, data: extractedElementHtml, method: config.method, xpath: config.xpath_main_content, htmlContent: pageContent };

    } catch (error) {
      logger.error(`${error.name || 'Error'} scraping with known config for ${url}: ${error.message}`, error.details);
      await this._saveDebugHtml('failure', config.domain_pattern, url, pageContent || error.details?.htmlContent || '');
      return { success: false, error: error.message, details: error.details, htmlContent: pageContent || error.details?.htmlContent };
    } finally {
      if (browser) {
        await this.puppeteerController.cleanupPuppeteer(browser);
      }
    }
  }

  // oldConfigHint parameter removed
  async _discoverAndScrape(url, domain, proxyDetails, userAgent, requestedOutput) {
    logger.info(`Starting content discovery for ${url}`);
    let browser = null;
    let page = null;
    let curlHtml = null;
    let puppeteerHtml = null;
    let htmlForAnalysis = null;
    let tentativeMethodIsCurl = false;
    let discoveredNeedsCaptcha = false;

    try {
      const curlResponse = await fetchWithCurl(url, proxyDetails, null, userAgent).catch(e => e);
      
      if (curlResponse.success && curlResponse.html) {
        curlHtml = curlResponse.html;
        if (this.htmlAnalyser.detectCaptchaMarkers(curlHtml)) {
          discoveredNeedsCaptcha = true;
          logger.info('CAPTCHA detected in cURL response.');
          if (curlHtml.includes('captcha-delivery.com') || curlHtml.includes('geo.captcha-delivery.com')) {
            logger.info('DataDome CAPTCHA detected in cURL response. Prioritizing CAPTCHA solving flow.');
            ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, userAgent));
            const captchaSolved = await this.captchaSolver.solveIfPresent(page, url);
            if (!captchaSolved) {
                puppeteerHtml = await this.puppeteerController.getPageContent(page).catch(() => null);
                throw new CaptchaError('DataDome CAPTCHA solving failed during discovery.', { htmlContent: puppeteerHtml || curlHtml });
            }
            await page.waitForTimeout(this.configs.scraper.puppeteerPostLoadDelay);
            puppeteerHtml = await this.puppeteerController.getPageContent(page);
            htmlForAnalysis = puppeteerHtml;
          }
        }
      } else {
        logger.warn(`cURL fetch failed for ${url}: ${curlResponse.error || curlResponse.message}`);
        curlHtml = curlResponse.html || null;
      }

      if (!htmlForAnalysis) { 
        try {
          ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, userAgent, null, true));
          puppeteerHtml = await this.puppeteerController.getPageContent(page);
          if (this.htmlAnalyser.detectCaptchaMarkers(puppeteerHtml)) {
            discoveredNeedsCaptcha = true;
            logger.info('CAPTCHA detected in Puppeteer probe response.');
          }
        } catch (probeError) {
          logger.error(`Initial Puppeteer probe failed for ${url}: ${probeError.message}`);
          if (!curlHtml) {
            throw new NetworkError('Both cURL and initial Puppeteer probe failed.', { originalError: probeError, curlError: curlResponse.error });
          }
        }
      }
      
      if (htmlForAnalysis) { 
         tentativeMethodIsCurl = false;
      } else if (curlHtml && puppeteerHtml) {
        const areSimilar = await this.domComparator.compareDoms(curlHtml, puppeteerHtml);
        if (areSimilar && !discoveredNeedsCaptcha) {
          htmlForAnalysis = curlHtml;
          tentativeMethodIsCurl = true;
          logger.info('cURL and Puppeteer DOMs are similar. Prioritizing cURL.');
          if (page) { await this.puppeteerController.cleanupPuppeteer(browser); browser = null; page = null; }
        } else {
          htmlForAnalysis = puppeteerHtml;
          tentativeMethodIsCurl = false;
          logger.info('DOMs differ or CAPTCHA implies Puppeteer. Using Puppeteer output.');
        }
      } else if (puppeteerHtml) {
        htmlForAnalysis = puppeteerHtml;
        tentativeMethodIsCurl = false;
        logger.info('Using Puppeteer output (cURL failed or not comparable).');
      } else if (curlHtml) {
        htmlForAnalysis = curlHtml;
        tentativeMethodIsCurl = true;
        logger.info('Using cURL output (Puppeteer probe failed).');
      } else {
        throw new NetworkError('Failed to retrieve any HTML content for analysis.');
      }

      if (!tentativeMethodIsCurl && page && htmlForAnalysis && !htmlForAnalysis.includes('captcha-delivery.com')) {
        logger.debug('Performing full interactions on Puppeteer page for discovery.');
        await this.puppeteerController.performInteractions(page);
        await page.waitForTimeout(this.configs.scraper.puppeteerPostLoadDelay);
        const freshPuppeteerHtml = await this.puppeteerController.getPageContent(page);
        if (this.htmlAnalyser.detectCaptchaMarkers(freshPuppeteerHtml) && !discoveredNeedsCaptcha) {
            discoveredNeedsCaptcha = true;
            logger.info('CAPTCHA detected after full Puppeteer load during discovery.');
        }
        htmlForAnalysis = freshPuppeteerHtml;
      }

      const snippets = this.htmlAnalyser.extractArticleSnippets(htmlForAnalysis);
      let llmFeedback = [];
      let foundXPath = null;
      let bestCandidateDetails = null;

      for (let i = 0; i < this.configs.scraper.maxLlmRetries; i++) {
        logger.info(`LLM attempt ${i + 1}/${this.configs.scraper.maxLlmRetries} for ${url}`);
        const candidateXPaths = await this.llmInterface.getCandidateXPaths(htmlForAnalysis, snippets, llmFeedback);

        if (!candidateXPaths || candidateXPaths.length === 0) {
          llmFeedback.push("LLM returned no candidate XPaths.");
          logger.warn("LLM returned no candidates on attempt " + (i+1));
          if (i < this.configs.scraper.maxLlmRetries - 1) continue;
          else break;
        }

        const scoredCandidates = [];
        for (const xpath of candidateXPaths) {
          const details = tentativeMethodIsCurl ?
            this.htmlAnalyser.queryStaticXPathWithDetails(htmlForAnalysis, xpath) :
            await this.puppeteerController.queryXPathWithDetails(page, xpath);

          if (!details || details.element_found_count === 0) {
            llmFeedback.push(`XPath '${xpath}' found 0 elements.`);
            continue;
          }
          const score = this.contentScoringEngine.scoreElement(details);
          if (score > this.configs.scraper.minXpathScoreThreshold) {
            scoredCandidates.push({ xpath, score, details });
          } else {
            llmFeedback.push(`XPath '${xpath}' scored low (${score.toFixed(2)}). P: ${details.paragraphCount || 0}, TL: ${details.textContentLength || 0}.`);
          }
        }

        if (scoredCandidates.length > 0) {
          scoredCandidates.sort((a, b) => b.score - a.score);
          foundXPath = scoredCandidates[0].xpath;
          bestCandidateDetails = scoredCandidates[0].details;
          logger.info(`Found promising XPath: ${foundXPath} with score: ${scoredCandidates[0].score}`);
          break; 
        }
        llmFeedback = llmFeedback.slice(-5);
      }

      if (foundXPath) {
        let methodToStore = tentativeMethodIsCurl ? METHODS.CURL : METHODS.PUPPETEER_STEALTH;
        if (discoveredNeedsCaptcha || (bestCandidateDetails && bestCandidateDetails.isCaptchaPage)) { // isCaptchaPage is hypothetical
          methodToStore = METHODS.PUPPETEER_CAPTCHA;
        }
        
        if (methodToStore === METHODS.CURL && discoveredNeedsCaptcha) {
            logger.warn(`Initial method was cURL, but CAPTCHA detected. Switching to puppeteer_captcha for ${domain}`);
            methodToStore = METHODS.PUPPETEER_CAPTCHA;
        }
        if (methodToStore === METHODS.CURL && curlHtml) { // Ensure curlHtml is available for this check
            const curlValidationContent = this.htmlAnalyser.extractByXpath(curlHtml, foundXPath);
            if (!curlValidationContent) {
                logger.warn(`XPath ${foundXPath} found via cURL analysis but failed re-validation on cURL HTML. Switching to Puppeteer method for ${domain}.`);
                methodToStore = discoveredNeedsCaptcha ? METHODS.PUPPETEER_CAPTCHA : METHODS.PUPPETEER_STEALTH;
            }
        }

        const newConfig = {
          domain_pattern: domain,
          method: methodToStore,
          xpath_main_content: foundXPath,
          last_successful_scrape_timestamp: new Date().toISOString(),
          failure_count_since_last_success: 0,
          site_specific_headers: null,
          user_agent_to_use: userAgent,
          needs_captcha_solver: methodToStore === METHODS.PUPPETEER_CAPTCHA,
          puppeteer_wait_conditions: null,
          discovered_by_llm: true,
        };
        await this.knownSitesManager.saveConfig(domain, newConfig);
        logger.info(`New config saved for ${domain}. Method: ${methodToStore}, XPath: ${foundXPath}`);

        const finalResult = await this._scrapeWithKnownConfig(url, newConfig, proxyDetails, userAgent, requestedOutput);
        if (!finalResult.success) {
            await this._saveDebugHtml('failure', domain, url, htmlForAnalysis);
        }
        return finalResult;

      } else {
        logger.error(`XPath discovery failed for ${url} after all retries.`);
        await this._saveDebugHtml('failure', domain, url, htmlForAnalysis);
        throw new ExtractionError('XPath discovery failed after all retries.', {htmlContent: htmlForAnalysis});
      }

    } catch (error) {
      logger.error(`${error.name || 'Error'} during discovery/scrape for ${url}: ${error.message}`, error.details);
      const errorHtmlContent = htmlForAnalysis || puppeteerHtml || curlHtml || error.details?.htmlContent || error.htmlContent || '';
      await this._saveDebugHtml('failure', domain, url, errorHtmlContent);
      if (error instanceof ScraperError) {
        error.details = { ...(error.details || {}), htmlContent: errorHtmlContent };
        throw error;
      }
      throw new ScraperError(`Discovery and scraping failed for ${url}: ${error.message}`, { originalError: error, htmlContent: errorHtmlContent });
    } finally {
      if (browser) {
        await this.puppeteerController.cleanupPuppeteer(browser);
      }
    }
  }
}

export { CoreScraperEngine };
EOF

echo "Creating constants.js"
mkdir -p ./src # Ensure src directory exists if constants.js is there
cat << 'EOF' > ./src/constants.js
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
EOF

echo "Creating analysis/dom-comparator.js"
mkdir -p ./analysis
cat << 'EOF' > ./analysis/dom-comparator.js
// src/analysis/dom-comparator.js
import TurndownService from 'turndown';
import { diffChars } from 'diff';
import { logger } from '../utils/logger.js';
import { ExtractionError } from '../utils/error-handler.js';

class DomComparator {
  constructor(similarityThreshold = 0.60) { // Default 60% similarity
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '*',
      codeBlockStyle: 'fenced',
      emDelimiter: '_',
    });
    // Remove script and style tags before conversion as they cause a lot of noise
    this.turndownService.remove(['script', 'style', 'noscript', 'iframe', 'link', 'meta', 'head']);
    this.similarityThreshold = similarityThreshold;
    logger.info(`DomComparator initialized with similarity threshold: ${this.similarityThreshold}`);
  }

  _htmlToMarkdown(htmlString) {
    if (typeof htmlString !== 'string') {
      logger.warn('_htmlToMarkdown: htmlString is not a string.');
      throw new ExtractionError('Invalid HTML string for Markdown conversion', {
        inputType: typeof htmlString
      });
    }
    try {
      return this.turndownService.turndown(htmlString);
    } catch (error) {
      logger.warn(`Error converting HTML to Markdown: ${error.message}`);
      throw new ExtractionError('Error converting HTML to Markdown', {
        originalError: error.message,
        htmlSnippet: htmlString.substring(0, 200)
      });
    }
  }

  _calculateSimilarity(str1, str2) {
    if (!str1 && !str2) return 1.0;
    if (!str1 || !str2) return 0.0;

    const changes = diffChars(str1, str2);
    let differingChars = 0;
    changes.forEach(part => {
      if (part.added || part.removed) {
        differingChars += part.count;
      }
    });

    let totalCharsInLongerString = Math.max(str1.length, str2.length);
    if (totalCharsInLongerString === 0) return 1.0;

    const similarity = 1 - (differingChars / totalCharsInLongerString);
    return Math.max(0, Math.min(1, similarity));
  }

  async compareDoms(htmlString1, htmlString2) {
    if (!htmlString1 && !htmlString2) {
      logger.debug("Both HTML strings are empty/null, considering them similar.");
      return true;
    }
    if (!htmlString1 || !htmlString2) {
      logger.debug("One HTML string is empty/null, considering them different.");
      // This might not be an error, but a valid state indicating difference.
      // Depending on strictness, an error could be thrown or just return false.
      // For now, let's treat it as a clear difference.
      return false;
    }

    const markdown1 = this._htmlToMarkdown(htmlString1);
    const markdown2 = this._htmlToMarkdown(htmlString2);

    const cleanMd1 = markdown1.replace(/\s+/g, ' ').trim();
    const cleanMd2 = markdown2.replace(/\s+/g, ' ').trim();

    if (!cleanMd1 && !cleanMd2) {
        logger.debug("Both HTML strings resulted in empty markdown after cleaning, considering them similar.");
        return true;
    }
    if (!cleanMd1 || !cleanMd2) {
        logger.debug("One HTML string resulted in empty markdown after cleaning, considering them different.");
        return false;
    }

    const similarityScore = this._calculateSimilarity(cleanMd1, cleanMd2);
    logger.info(`DOM similarity score: ${similarityScore.toFixed(4)}`);
    return similarityScore >= this.similarityThreshold;
  }
}

export { DomComparator };
EOF

echo "Creating browser/puppeteer-controller.js"
mkdir -p ./browser
cat << 'EOF' > ./browser/puppeteer-controller.js
// src/browser/puppeteer-controller.js
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { logger } from '../utils/logger.js';
import { NetworkError } from '../utils/error-handler.js';
import { scraperSettings as globalScraperSettings } from '../../config/index.js'; // For default values

// Apply the stealth plugin
puppeteer.use(StealthPlugin());

class PuppeteerController {
  constructor(pluginManager, scraperConfig = {}) {
    this.pluginManager = pluginManager;
    this.executablePath = scraperConfig.puppeteerExecutablePath || globalScraperSettings.puppeteerExecutablePath;
    this.defaultTimeout = scraperConfig.puppeteerDefaultTimeout || globalScraperSettings.puppeteerDefaultTimeout;
    this.navigationTimeout = scraperConfig.puppeteerNavigationTimeout || globalScraperSettings.puppeteerNavigationTimeout;
    this.networkIdleTimeout = scraperConfig.puppeteerNetworkIdleTimeout || globalScraperSettings.puppeteerNetworkIdleTimeout;
    this.postLoadDelay = scraperConfig.puppeteerPostLoadDelay || globalScraperSettings.puppeteerPostLoadDelay;
    this.interactionDelay = scraperConfig.puppeteerInteractionDelay || globalScraperSettings.puppeteerInteractionDelay;

    logger.debug('PuppeteerController initialized with timeouts:', {
        default: this.defaultTimeout,
        navigation: this.navigationTimeout,
        networkIdle: this.networkIdleTimeout
    });
  }

  async launchBrowser(proxyDetails = null) {
    const launchOptions = {
      headless: process.env.PUPPETEER_HEADLESS === 'false' ? false : (process.env.PUPPETEER_HEADLESS || 'new'),
      executablePath: this.executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        // '--single-process', // Linux only, can cause issues
        '--disable-gpu',
        '--window-size=1920,1080'
      ],
      ignoreHTTPSErrors: true,
      defaultViewport: {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        isLandscape: false,
      },
    };

    if (proxyDetails && proxyDetails.server) {
      try {
        const parsedProxyUrl = new URL(proxyDetails.server);
        const proxyHostPort = `${parsedProxyUrl.hostname}:${parsedProxyUrl.port || (parsedProxyUrl.protocol === 'https:' ? '443' : '80')}`;
        launchOptions.args.push(`--proxy-server=${proxyHostPort}`);
        logger.info(`Puppeteer: Using proxy server ${proxyHostPort}`);
      } catch (e) {
        logger.error(`Invalid proxy server string for Puppeteer: ${proxyDetails.server}. Error: ${e.message}`);
        // Decide if to throw or continue without proxy
      }
    }
    
    if (this.pluginManager) {
      await this.pluginManager.configureLaunchOptions(launchOptions);
    }

    logger.info('Launching Puppeteer browser with options:', launchOptions.args);
    try {
      const browser = await puppeteer.launch(launchOptions);
      logger.info('Puppeteer browser launched successfully.');
      return browser;
    } catch (error) {
      logger.error(`Failed to launch Puppeteer browser: ${error.message}`);
      throw new NetworkError('Failed to launch Puppeteer browser', {
        launchOptions: JSON.stringify(launchOptions.args), // Only log args for brevity
        originalError: error.message
      });
    }
  }

  async newPage(browser, userAgentString = null) {
    try {
      const page = await browser.newPage();
      if (userAgentString) {
        await page.setUserAgent(userAgentString);
      }
      page.setDefaultNavigationTimeout(this.navigationTimeout);
      page.setDefaultTimeout(this.defaultTimeout);
      logger.debug('New Puppeteer page created.');
      return page;
    } catch (error) {
      logger.error(`Failed to create new Puppeteer page: ${error.message}`);
      throw new NetworkError('Failed to create new Puppeteer page', {
        originalError: error.message
      });
    }
  }

  async launchAndNavigate(url, proxyDetails = null, userAgentString = null, waitConditions = null, isInitialProbe = false) {
    let browser = null; // Define browser here to ensure it's in scope for finally
    try {
      browser = await this.launchBrowser(proxyDetails);
      const page = await this.newPage(browser, userAgentString);

      if (proxyDetails && proxyDetails.server) {
        const parsedProxyUrl = new URL(proxyDetails.server);
        if (parsedProxyUrl.username || parsedProxyUrl.password) {
            await page.authenticate({
                username: decodeURIComponent(parsedProxyUrl.username),
                password: decodeURIComponent(parsedProxyUrl.password)
            });
            logger.info('Puppeteer: Proxy authentication set.');
        }
      }
      
      await this.navigate(page, url, waitConditions, isInitialProbe);
      return { browser, page }; // Return both so caller can manage browser or page can be detached
    } catch (error) {
      logger.error(`Navigation failed in launchAndNavigate for ${url}: ${error.message}`);
      if (browser) { // Ensure browser is closed if launchAndNavigate fails partway
        await this.cleanupPuppeteer(browser).catch(e => logger.warn(`Error cleaning up browser during launchAndNavigate failure: ${e.message}`));
      }
      if (error instanceof NetworkError) throw error;
      throw new NetworkError(`Navigation failed for ${url}`, {
        url,
        originalError: error.message
      });
    }
  }

  async navigate(page, url, waitConditions = null, isInitialProbe = false) {
    logger.info(`Navigating to URL: ${url}`);
    const effectiveWaitUntil = waitConditions?.waitUntil || (isInitialProbe ? 'domcontentloaded' : 'networkidle2');
    
    try {
      await page.goto(url, {
        waitUntil: effectiveWaitUntil,
        timeout: this.navigationTimeout,
      });
      logger.info(`Navigation successful to: ${url} (waited for ${effectiveWaitUntil})`);

      if (this.pluginManager) {
        await this.pluginManager.applyToPageAfterNavigation(page);
      }
      
      if (!isInitialProbe) { // Perform more interactions if not just a quick probe
        await this.performInteractions(page);
        await page.waitForTimeout(this.postLoadDelay);
      } else {
        await page.waitForTimeout(500); // Shorter delay for probes
      }

    } catch (error) {
      logger.error(`Navigation to ${url} failed: ${error.message}`);
      throw new NetworkError(`Navigation to ${url} failed`, {
        url,
        waitUntil: effectiveWaitUntil,
        originalError: error.message
      });
    }
  }

  async performInteractions(page) {
    logger.debug('Performing generic page interactions (scroll, mouse move).');
    try {
      await page.evaluate(async (delay) => {
        for (let i = 0; i < 5; i++) { // Scroll down a few times
          window.scrollBy(0, window.innerHeight / 2);
          await new Promise(resolve => setTimeout(resolve, delay / 5 + Math.random() * 50));
        }
        window.scrollTo(0, 0); // Scroll back to top
      }, this.interactionDelay);

      await page.mouse.move(Math.random() * 500 + 100, Math.random() * 500 + 100);
      await page.waitForTimeout(this.interactionDelay / 4);
      logger.debug('Generic interactions completed.');
    } catch (error) {
      logger.warn(`Error during generic page interactions: ${error.message}`);
    }
  }

  async getPageContent(page) {
    try {
      const content = await page.content();
      logger.debug('Page content retrieved.');
      return content;
    } catch (error) {
      logger.error(`Failed to get page content: ${error.message}`);
      throw new NetworkError('Failed to get page content', {
        pageUrl: await page.url().catch(() => 'unknown_url'),
        originalError: error.message
      });
    }
  }

  async queryXPathWithDetails(page, xpath) {
    logger.debug(`Querying XPath: ${xpath}`);
    const result = {
      xpath,
      element_found_count: 0,
      tagName: null,
      id: null,
      className: null,
      textContentLength: 0,
      innerHTMLSnippet: null,
      paragraphCount: 0,
      linkCount: 0,
      imageCount: 0,
      totalDescendantElements: 0,
    };

    let elements = [];
    try {
      elements = await page.$x(xpath);
      result.element_found_count = elements.length;

      if (elements.length > 0) {
        const firstElement = elements[0];
        result.tagName = await page.evaluate(el => el.tagName.toLowerCase(), firstElement);
        result.id = await page.evaluate(el => el.id || null, firstElement);
        result.className = await page.evaluate(el => el.className || null, firstElement);
        
        const textContent = await page.evaluate(el => el.textContent || '', firstElement);
        result.textContentLength = textContent.trim().length;
        
        const innerHTML = await page.evaluate(el => el.innerHTML || '', firstElement);
        result.innerHTMLSnippet = innerHTML.substring(0, 200) + (innerHTML.length > 200 ? '...' : '');
        result.innerHTML = innerHTML; // Store full innerHTML for scoring if needed

        result.paragraphCount = (await firstElement.$$('p')).length;
        result.linkCount = (await firstElement.$$('a')).length;
        result.imageCount = (await firstElement.$$('img')).length;
        result.totalDescendantElements = (await firstElement.$$('*')).length;
      }
    } catch (error) {
      logger.warn(`Error querying XPath "${xpath}" on page: ${error.message}`);
      result.error = error.message; // Add error to result for feedback
    } finally {
      for (const el of elements) { // Dispose all element handles
        await el.dispose();
      }
    }
    return result;
  }

  async cleanupPuppeteer(browser) {
    if (browser && browser.isConnected()) {
      try {
        await browser.close();
        logger.info('Puppeteer browser closed successfully.');
      } catch (error) {
        logger.error(`Failed to close Puppeteer browser: ${error.message}`);
      }
    } else {
      logger.debug('Puppeteer browser already closed or not connected.');
    }
  }
}

export { PuppeteerController };
EOF

echo "Creating config/captcha-solver-config.js"
mkdir -p ./config
cat << 'EOF' > ./config/captcha-solver-config.js
// config/captcha-solver-config.js
import dotenv from 'dotenv';
dotenv.config();

export const captchaSolverConfig = {
  apiKey: process.env.TWOCAPTCHA_API_KEY,
  service: process.env.CAPTCHA_SERVICE_NAME || '2captcha',
  defaultTimeout: 120, 
  pollingInterval: 5, 
  navigationTimeout: 60000,
  postCaptchaSubmitDelay: 5000,
  proxy: {
    server: process.env.HTTP_PROXY || null,
  },
  inUrl: 'https://2captcha.com/in.php',
  resUrl: 'https://2captcha.com/res.php',
  createTaskUrl: 'https://api.2captcha.com/createTask',
  getTaskResultUrl: 'https://api.2captcha.com/getTaskResult'
};
EOF

echo "Creating services/llm-interface.js"
mkdir -p ./services
cat << 'EOF' > ./services/llm-interface.js
// src/services/llm-interface.js
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { LLMError, ConfigurationError } from '../utils/error-handler.js';
import { llmConfig as globalLlmConfig } from '../../config/index.js'; // For default values

class LLMInterface {
  constructor(llmConfig = {}) {
    this.apiKey = llmConfig.apiKey || globalLlmConfig.apiKey;
    this.endpoint = llmConfig.chatCompletionsEndpoint || globalLlmConfig.chatCompletionsEndpoint;
    this.model = llmConfig.model || globalLlmConfig.model;
    this.defaultTemperature = llmConfig.defaultTemperature !== undefined ? llmConfig.defaultTemperature : globalLlmConfig.defaultTemperature;
    this.defaultMaxTokens = llmConfig.defaultMaxTokens || globalLlmConfig.defaultMaxTokens;

    if (!this.apiKey || !this.endpoint || !this.model) {
      throw new ConfigurationError('LLMInterface: Missing required LLM configuration values (apiKey, chatCompletionsEndpoint, model)', {
        apiKeyProvided: !!this.apiKey,
        endpointProvided: !!this.endpoint,
        modelProvided: !!this.model
      });
    }
    
    this.axiosInstance = axios.create({
      baseURL: this.endpoint.substring(0, this.endpoint.lastIndexOf('/')),
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://smartscraper.dev', // Example, replace with actual or leave out
        'X-Title': 'SmartScraper Universal Scraper', // Example
      },
    });
    logger.info(`LLMInterface initialized for model: ${this.model}`);
  }

  _constructPrompt(htmlContentSummary, snippets, feedbackContext) {
    const maxHtmlLength = 15000; // Consider making this configurable
    let truncatedHtml = htmlContentSummary;
    if (htmlContentSummary.length > maxHtmlLength) {
      truncatedHtml = htmlContentSummary.substring(0, maxHtmlLength) + "\n... (HTML truncated) ...";
    }

    let prompt = `
Analyze the following HTML content summary and text snippets to identify the main article content.
Provide up to 5 candidate XPath expressions that point to the primary article container.
Return the XPaths as a JSON array of strings. Example: ["//div[@id='main-content']", "//article[contains(@class,'post-body')]"]

HTML Content Summary (first ${maxHtmlLength} chars if truncated):
\`\`\`html
${truncatedHtml}
\`\`\`
`;
    if (snippets && snippets.length > 0) {
      prompt += `
Key Text Snippets from the page:
${snippets.map(s => `- "${s.substring(0, 100)}${s.length > 100 ? '...' : ''}"`).join('\n')}
`;
    }

    if (feedbackContext && feedbackContext.length > 0) {
      prompt += `
Previous XPath attempts and feedback (use this to refine your suggestions):
${feedbackContext.map(f => `- ${f}`).join('\n')}
`;
    }
    prompt += "\nCandidate XPaths (JSON array of strings):";
    return prompt.trim();
  }

  async getCandidateXPaths(htmlContent, snippets, feedbackContext = []) {
    const prompt = this._constructPrompt(htmlContent, snippets, feedbackContext);
    const payload = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: this.defaultTemperature,
      max_tokens: this.defaultMaxTokens,
    };

    logger.info(`Sending request to LLM. Prompt length (approx): ${prompt.length} chars.`);
    try {
      const response = await this.axiosInstance.post(
        this.endpoint.substring(this.endpoint.lastIndexOf('/')), // Path part, e.g., /chat/completions
        payload,
        { timeout: 45000 } // 45 second timeout
      );

      if (response.data && response.data.choices && response.data.choices.length > 0) {
        const messageContent = response.data.choices[0].message?.content;
        if (messageContent) {
          logger.debug(`LLM raw response content: ${messageContent}`);
          try {
            const cleanedContent = messageContent.replace(/^```json\s*|```\s*$/g, '').trim();
            const xpaths = JSON.parse(cleanedContent);
            if (Array.isArray(xpaths) && xpaths.every(item => typeof item === 'string' && item.startsWith('/'))) {
              logger.info(`LLM returned ${xpaths.length} candidate XPaths.`);
              return xpaths.filter((xpath, index, self) => self.indexOf(xpath) === index);
            }
            logger.warn('LLM response content was not a valid JSON array of valid XPath strings:', cleanedContent);
            throw new LLMError('LLM response content was not a valid JSON array of valid XPath strings', { rawContent: cleanedContent });
          } catch (parseError) {
            logger.error(`Failed to parse LLM response as JSON: ${parseError.message}. Raw content: ${messageContent}`);
            // Fallback: try to extract XPaths using a regex (less reliable)
            const xpathRegex = /(\/\/[a-zA-Z0-9\-_:\*\[\]\(\)@=\.'"\s]+)/g;
            const extracted = messageContent.match(xpathRegex);
            if (extracted && extracted.length > 0) {
              logger.warn(`Fallback: Extracted ${extracted.length} XPaths using regex.`);
              return extracted.filter((xpath, index, self) => self.indexOf(xpath) === index);
            }
            throw new LLMError('Failed to parse LLM response and fallback regex extraction failed.', {
                originalError: parseError.message,
                rawContent: messageContent.substring(0, 500) + (messageContent.length > 500 ? '...' : '')
            });
          }
        }
      }
      logger.warn('LLM response did not contain expected message content or choices.', { responseData: response.data });
      throw new LLMError('LLM response did not contain expected message content or choices', { responseData: response.data });
    } catch (error) {
      if (error instanceof LLMError) throw error; // Re-throw if already our custom error

      if (error.response) {
        logger.error(`LLM API request failed with status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
        throw new LLMError(`LLM API request failed with status ${error.response.status}`, {
          statusCode: error.response.status,
          responseData: error.response.data,
          originalError: error.message
        });
      } else if (error.request) {
        logger.error(`LLM API request failed: No response received. ${error.message}`);
        throw new LLMError('LLM API request failed: No response received', { originalError: error.message });
      } else {
        logger.error(`Error setting up LLM API request: ${error.message}`);
        throw new LLMError(`Error setting up LLM API request: ${error.message}`, { originalError: error.message });
      }
    }
  }
}

export { LLMInterface };
EOF

echo "Creating network/curl-handler.js"
mkdir -p ./network
cat << 'EOF' > ./network/curl-handler.js
// src/network/curl-handler.js
import axios from 'axios';
import https from 'https'; // To configure a custom agent for ignoring SSL errors if needed
import { logger } from '../utils/logger.js';
import { NetworkError } from '../utils/error-handler.js';
import { DEFAULT_USER_AGENT } from '../constants.js';

const DEFAULT_TIMEOUT = 15000; // 15 seconds default timeout for cURL requests

async function fetchWithCurl(
  url,
  proxyDetails = null,
  customHeaders = null,
  userAgentString = null,
  timeout = DEFAULT_TIMEOUT,
  ignoreHttpsErrors = true
) {
  const effectiveUserAgent = userAgentString || DEFAULT_USER_AGENT;
  const headers = {
    'User-Agent': effectiveUserAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br', // Axios handles decompression automatically
    ...(customHeaders || {}),
  };

  const axiosConfig = {
    headers,
    timeout,
    responseType: 'text',
    maxRedirects: 5,
  };

  if (proxyDetails && proxyDetails.server) {
    try {
      const proxyUrl = new URL(proxyDetails.server);
      axiosConfig.proxy = {
        protocol: proxyUrl.protocol.replace(':', ''),
        host: proxyUrl.hostname,
        port: parseInt(proxyUrl.port, 10) || (proxyUrl.protocol === 'https:' ? 443 : 80),
        auth: (proxyUrl.username || proxyUrl.password) ? {
          username: decodeURIComponent(proxyUrl.username),
          password: decodeURIComponent(proxyUrl.password),
        } : undefined,
      };
      logger.info(`Using proxy for cURL request: ${axiosConfig.proxy.host}:${axiosConfig.proxy.port}`);
    } catch (e) {
      logger.error(`Invalid proxy server string for cURL: ${proxyDetails.server}. Error: ${e.message}`);
      // Decide if to throw or continue without proxy
      // For now, let's throw as proxy config error is critical
      throw new NetworkError(`Invalid proxy server string format for cURL`, { proxyServer: proxyDetails.server, originalError: e.message });
    }
  }

  if (ignoreHttpsErrors) {
    axiosConfig.httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });
  }

  logger.info(`Making cURL-like request to: ${url}`);
  try {
    const response = await axios.get(url, axiosConfig);
    logger.info(`cURL request to ${url} successful with status: ${response.status}`);
    return {
      success: true,
      html: response.data,
      status: response.status,
      headers: response.headers,
      error: null,
    };
  } catch (error) {
    if (error instanceof NetworkError) throw error; // Re-throw if already our custom error

    logger.error(`cURL request to ${url} failed. Error: ${error.message}`);
    if (error.response) {
      logger.error(`Status: ${error.response.status}, Data: ${typeof error.response.data === 'string' ? error.response.data.substring(0, 200) : 'Non-string data'}`);
      return {
        success: false,
        html: typeof error.response.data === 'string' ? error.response.data : null,
        status: error.response.status,
        headers: error.response.headers,
        error: `HTTP Error ${error.response.status}: ${error.message}`,
      };
    } else if (error.request) {
      logger.error('No response received for cURL request.');
      return {
        success: false,
        html: null,
        status: null,
        headers: null,
        error: `No response received: ${error.message}`,
      };
    } else {
      logger.error(`Error setting up cURL request: ${error.message}`);
      return {
        success: false,
        html: null,
        status: null,
        headers: null,
        error: `Request setup error: ${error.message}`,
      };
    }
  }
}

export { fetchWithCurl };
EOF

echo "Creating utils/url-helpers.js"
mkdir -p ./utils
cat << 'EOF' > ./utils/url-helpers.js
// src/utils/url-helpers.js
// No console.log or console.error should be used here directly. Use logger if needed.
import { URL } from 'url'; // Node.js built-in URL module

/**
 * Normalizes a URL to get a consistent domain key.
 * Removes 'www.', scheme, path, query, and fragment.
 * Converts to lowercase.
 * @param {string} urlString - The URL string to normalize.
 * @returns {string|null} The normalized domain (e.g., "example.com") or null if URL is invalid.
 */
function normalizeDomain(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return null;
  }
  try {
    // Ensure a scheme is present for proper parsing, default to http if missing
    let prefixedUrl = urlString;
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
      prefixedUrl = 'http://' + urlString;
    }
    const parsedUrl = new URL(prefixedUrl);
    let hostname = parsedUrl.hostname;
    // Remove 'www.' prefix if it exists
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    return hostname.toLowerCase();
  } catch (error) {
    // logger.warn(`[URL HELPER] Error normalizing URL "${urlString}": ${error.message}`); // Use logger if this needs to be logged
    return null; // Invalid URL
  }
}

/**
 * Extracts the base domain from a hostname (e.g., "blog.example.com" -> "example.com").
 * This is a simple implementation and might not cover all edge cases for complex TLDs (e.g., .co.uk).
 * @param {string} hostname - The hostname (e.g., "www.blog.example.com").
 * @returns {string|null} The base domain or null if input is invalid.
 */
function getBaseDomain(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    return null;
  }
  const parts = hostname.split('.');
  if (parts.length < 2) {
    return hostname; // Or null if it's just 'com' or something invalid
  }
  // Simple heuristic: if more than 2 parts, take the last two.
  // This doesn't handle multi-part TLDs like 'co.uk' perfectly without a TLD list.
  // A more robust solution would involve a list of public suffixes (e.g., from publicsuffix.org)
  // For now, a common case:
  if (parts.length >= 3 && (parts[parts.length-2] === 'co' || parts[parts.length-2] === 'com' || parts[parts.length-2] === 'org' || parts[parts.length-2] === 'net' || parts[parts.length-2] === 'gov')) {
      // Handles cases like example.co.uk, example.com.au
      if (parts.length >= 3) return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.'); // e.g. example.com from blog.example.com
}

/**
 * Checks if a URL is valid.
 * @param {string} urlString
 * @returns {boolean}
 */
function isValidUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return false;
  }
  try {
    new URL(urlString);
    return true;
  } catch (e) {
    return false;
  }
}

export { normalizeDomain, getBaseDomain, isValidUrl };
EOF

echo "Creating config/index.js"
mkdir -p ./config
cat << 'EOF' > ./config/index.js
// config/index.js
// This file serves as a central point for exporting all configurations.

// Import individual configuration modules
import { llmConfig } from './llm-config.js';
import { scraperSettings } from './scraper-settings.js';
import { captchaSolverConfig } from './captcha-solver-config.js';
// You can add more specific config imports here if needed

// Combine all configurations into a single object or export them individually

// Option 1: Exporting a single combined object (useful if you want to pass all configs around easily)
// const allConfigs = {
//   llm: llmConfig,
//   scraper: scraperSettings,
//   captchaSolver: captchaSolverConfig,
//   // Add other top-level config groups here
// };

// Option 2: Exporting individual config objects (more common and often preferred for clarity)
// This is generally the recommended approach for ES modules.
export {
  llmConfig,
  scraperSettings,
  captchaSolverConfig,
};
// Export other config objects directly if you add more

// You could also choose to export the combined object if that fits your style:
// export default allConfigs;
// However, named exports (as above) are usually more flexible for consumers.
EOF

echo "Creating src/index.js"
mkdir -p ./src
cat << 'EOF' > ./src/index.js
// src/index.js
import dotenv from 'dotenv';
// Load environment variables (if using .env file)
// This should be one of the first things to run if your configs depend on .env
dotenv.config(); // Loads .env file from project root

// Import core components and configurations
import { CoreScraperEngine } from './core/engine.js';
import { logger } from './utils/logger.js';
import { isValidUrl, normalizeDomain } from './utils/url-helpers.js';
import { OUTPUT_TYPES, DEFAULT_USER_AGENT } from './constants.js';
import {
  llmConfig,
  scraperSettings,
  captchaSolverConfig
} from '../config/index.js'; // Default configurations
import { ConfigurationError, ScraperError } from './utils/error-handler.js';


// Store a single instance of the engine if desired, or allow creating multiple
let defaultEngineInstance = null;

function getDefaultEngine() {
  if (!defaultEngineInstance) {
    // Initialize with default configurations loaded from config/index.js
    // These configs would have already picked up .env values if dotenv.config() was called.
    defaultEngineInstance = new CoreScraperEngine({
      scraperSettings, // Pass the imported scraperSettings directly
      llmConfig,       // Pass the imported llmConfig
      captchaSolverConfig // Pass the imported captchaSolverConfig
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
 * @param {object|null} [options.proxyDetails=null] - Proxy configuration. Example: { server: 'http://user:pass@host:port' }
 * @param {string|null} [options.userAgentString=null] - Custom User-Agent string.
 * @param {string} [options.outputType='content'] - Desired output type ('content' or 'full_html').
 *                                                  See OUTPUT_TYPES in constants.js.
 * @returns {Promise<{success: boolean, data: string|null, error: string|null, method?: string, xpath?: string, message?: string, details?: object, htmlContent?: string}>}
 *          The result of the scraping attempt.
 */
async function scrapeUrl(url, options = {}) {
  const {
    proxyDetails = null,
    userAgentString = null,
    outputType = OUTPUT_TYPES.CONTENT_ONLY,
  } = options;

  if (!isValidUrl(url)) {
    const errorMsg = `Invalid URL format provided: ${url}`;
    logger.error(errorMsg);
    // For consistency, throw a ScraperError or ConfigurationError
    throw new ConfigurationError('Invalid URL format', { url });
  }

  if (!Object.values(OUTPUT_TYPES).includes(outputType)) {
    const errorMsg = `Invalid outputType specified: ${outputType}. Valid types are: ${Object.values(OUTPUT_TYPES).join(', ')}`;
    logger.error(errorMsg);
    throw new ConfigurationError('Invalid output type', {
      specifiedType: outputType,
      validTypes: Object.values(OUTPUT_TYPES)
    });
  }

  try {
    const engine = getDefaultEngine();
    const result = await engine.scrape(url, proxyDetails, userAgentString, outputType);
    return result; // engine.scrape should return a structured object
  } catch (error) {
    // Handle different types of errors
    if (error instanceof ScraperError) {
      logger.error(`${error.name} during scrapeUrl for ${url}: ${error.message}`, error.details);
      return {
        success: false,
        data: null,
        error: error.message,
        message: error.message, // Redundant but common
        details: error.details,
        errorType: error.name.replace('Error', '').toLowerCase(),
        htmlContent: error.details?.htmlContent || null
      };
    }
    // For unexpected errors
    logger.error(`Unhandled error during scrapeUrl for ${url}: ${error.message}`, error.stack);
    return {
      success: false,
      data: null,
      error: 'An unexpected error occurred during scraping.',
      message: error.message,
      details: { originalError: error.message, stack: error.stack },
      errorType: 'unhandled',
      htmlContent: null
    };
  }
}

// Export the main engine class for advanced usage and the convenience function.
export {
  CoreScraperEngine,
  scrapeUrl,
  // Export configurations and constants if consumers might need them
  llmConfig,
  scraperSettings,
  captchaSolverConfig,
  OUTPUT_TYPES,
  DEFAULT_USER_AGENT,
  logger // Export logger if consumers might want to use the same instance
};
EOF

echo "Creating README.md"
# This will overwrite your existing README.md with the content you provided.
mkdir -p ./
cat << 'EOF' > ./README.md
# Universal Web Scraper: Detailed Specification (v5 - Revised)

## 1. Goal

To create a robust, **modular**, and adaptive web scraper capable of extracting relevant content from a wide variety of websites, including those with anti-scraping measures. The system should learn from successful scrapes to improve efficiency for known sites.

## 2. Core Principles

* **Modularity:** The system is designed as a collection of loosely coupled modules with well-defined responsibilities and interfaces, facilitating maintainability, testability, and extensibility.
* **Tiered Approach:** Prioritize simpler, faster methods (like cURL) and escalate to more complex, resource-intensive methods (like Puppeteer with LLM-assisted XPath discovery) only when necessary.
* **Learning & Adaptation:** Store successful scraping configurations (method, XPath, CAPTCHA needs) for known domains to expedite future requests. Re-discover configurations if they become stale.
* **Proxy Usage:** Supports HTTP proxies to bypass website restrictions and improve scraping success rates. Handles proxy authentication and configuration automatically.
* **Anti-Bot Evasion:** Puppeteer usage implies advanced stealth techniques by default, primarily through **`puppeteer-extra` and `puppeteer-extra-plugin-stealth`**. CAPTCHA solving is an additional layer.
* **Efficient LLM Usage:** (Planned) Extract only DOM structure with text size annotations instead of sending full HTML content to the LLM, reducing token usage while maintaining accuracy. (Currently sends full HTML for analysis).
* **Deterministic XPath Generation:** Set LLM temperature to zero for consistent and reliable XPath generation.

## 3. Obstacles Addressed

* User-Agent checks (assumes UA is provided or a reasonable default is used).
* Basic IP-based blocking (bypassed using HTTP proxies with authentication).
* Advanced bot detection (mitigated by `puppeteer-extra-plugin-stealth`).
* GDPR consent banners (via generic clickers, acknowledging limitations).
* CAPTCHAs (via integration with external solvers, with specific support for DataDome CAPTCHA detection and handling).
* Soft paywalls (basic attempts via plugins/interaction).
* Dynamic content loading triggered by user interaction (mouse movements, scrolling).
* Website structure changes breaking XPaths (via re-discovery).
* Identifying relevant content on unknown pages.
* Large HTML content exceeding LLM token limits (mitigation planned via DOM structure extraction).

## 4. Internal Data Structure: `KnownSitesTable`

This table (e.g., a JSON file or database), managed by the `KnownSitesTableManager` module, stores configurations for domains where scraping has been successful. Each entry could be keyed by a domain pattern.

**Fields per entry:**

* `domain_pattern`: The URL pattern this configuration applies to.
* `method`: The determined scraping method (`curl`, `puppeteer_stealth`, `puppeteer_captcha`).
* `xpath_main_content`: The validated XPath to the main relevant content.
* `last_successful_scrape_timestamp`: Timestamp of the last successful scrape using this config.
* `failure_count_since_last_success`: Counter for consecutive failures, to trigger re-validation/re-discovery.
* `site_specific_headers`: (Optional) Any custom HTTP headers required.
* `user_agent_to_use`: (Optional) A specific User-Agent string if one proved particularly effective (can be overridden by request-specific UA).
* `needs_captcha_solver`: (Boolean) True if a CAPTCHA was detected during discovery. If true, `method` will typically be `puppeteer_captcha`.
* `puppeteer_wait_conditions`: (Optional) Specific conditions for Puppeteer to wait for.
* `discovered_by_llm`: (Boolean) True if the XPath was found via the LLM discovery process.

## 5. High-Level Algorithm Flow (Orchestrated by a Core Scraper Engine)

1. **Request Initiation:** Core engine receives URL, proxy info, User-Agent (optional), etc.
2. **Known Site Check (via `KnownSitesTableManager`):**
   * If **Known Site & Config Valid:** Use stored configuration.
   * If **Known Site & Config Stale/Fails:** Trigger re-discovery.
   * If **Unknown Site:** Proceed to discovery.
3. **Unknown Site / Re-Discovery Process (Orchestrated by Discovery Sub-system):**
   * Utilize `CurlHandler` and `PuppeteerController` (with `puppeteer-extra-plugin-stealth`) to fetch page content.
   * `HtmlAnalyser` (now `HtmlAnalyserFixed`) checks for CAPTCHAs and JS dependency using `document.evaluate`.
   * (Planned: Extract DOM structure with text size annotations using `HtmlAnalyser.extractDomStructure()`).
   * Employ "SmartScraper" logic (combining `LLMInterface`, `ContentScoringEngine`, `HtmlAnalyser`) to identify XPath and confirm CAPTCHA needs.
   * If successful, `KnownSitesTableManager` stores new configuration.
4. **Content Extraction (Orchestrated by Extraction Sub-system):** Use determined method, XPath, and `CaptchaSolverIntegration` if needed.
5. **Return Data.**

## 6. Detailed Algorithm Steps

(Refer to `core/engine.js` for the most up-to-date logic. The general flow remains similar to the original README, with refinements in CAPTCHA handling and discovery.)

## 7. Modular Architecture & Key Sub-Modules

The system is designed with modularity in mind. Key modules include:

* **`CoreScraperEngine`**: Orchestrates the main workflow.
* **`KnownSitesTableManager`**: Manages `KnownSitesTable`.
* **`PuppeteerController`**: Manages Puppeteer instances, stealth, navigation.
* **`CurlHandler`**: Executes HTTP requests (currently via `axios`).
* **`DomComparator`**: Compares HTML DOM structures.
* **`LLMInterface`**: Interacts with the LLM API.
* **`ContentScoringEngine`**: Scores XPath candidates.
* **`CaptchaSolver` / `DataDomeSolver`**: Interfaces with CAPTCHA solving services.
* **`HtmlAnalyser` (effectively `HtmlAnalyserFixed`)**: Performs static HTML analysis, XPath evaluation using JSDOM and `document.evaluate`.
* **`PluginManager`**: Manages browser extensions loaded into Puppeteer, now configurable via `EXTENSION_PATHS`.

## 8. Common Content Patterns

(As previously listed in the original README - this section remains relevant for `ContentScoringEngine` and LLM prompting.)

## 9. Failure Handling & Re-validation

* Stale config detection (based on `failure_count_since_last_success` and `last_successful_scrape_timestamp`).
* Proactive re-validation.
* Debugging: If `DEBUG=true` in `.env`, HTML content for failed scrapes is saved to `./failed_html_dumps/`. If `SAVE_HTML_ON_SUCCESS_NAV=true` as well, HTML for successful scrapes is saved to `./success_html_dumps/`.
* LLM error handling.

## 10. Configuration

The system uses environment variables for configuration. Create a `.env` file in the root directory.

**Revised `.env` Example:**

\`\`\`dotenv
# --- LLM Configuration ---
# Your OpenRouter API Key
OPENROUTER_API_KEY=sk-or-v1-xxx
# The LLM model identifier to use
LLM_MODEL=google/gemini-2.0-flash-lite-001
# The temperature setting for the LLM (0 for deterministic output)
LLM_TEMPERATURE=0

# --- Puppeteer Configuration ---
# Path to your Chrome/Chromium executable (required if not in default path)
EXECUTABLE_PATH=/usr/lib/chromium/chromium
# Comma-separated list of absolute paths to browser extensions to load
EXTENSION_PATHS=/path/to/extension1/src,/path/to/extension2
# Whether to run Puppeteer in headless mode (true, false, or 'new')
# PUPPETEER_HEADLESS=true # This is typically configured in puppeteer-controller.js directly or via process.env.PUPPETEER_HEADLESS
# Timeout for Puppeteer operations in milliseconds
# PUPPETEER_TIMEOUT=30000 # This is typically configured in scraper-settings.js

# --- Proxy Configuration ---
# HTTP proxy for web scraping (format: http://username:password@hostname:port)
# This proxy is used for both curl and Puppeteer requests
HTTP_PROXY=http://your_proxy_user:your_proxy_pass@proxy.example.com:8080

# --- CAPTCHA Solver Configuration ---
# Your 2Captcha API key (or other supported service)
TWOCAPTCHA_API_KEY=your_2captcha_api_key_here
# CAPTCHA service name (default: 2captcha)
CAPTCHA_SERVICE_NAME=2captcha
# List of domains that need DataDome CAPTCHA handling (comma-separated)
# DATADOME_DOMAINS=wsj.com,nytimes.com # This is managed internally or could be a future enhancement

# --- Logging & Debugging Configuration ---
# Set to DEBUG, INFO, WARN, ERROR, or NONE
LOG_LEVEL=INFO
# Enable debug features like saving HTML dumps
DEBUG=false
# If DEBUG=true, save HTML of successfully scraped pages
SAVE_HTML_ON_SUCCESS_NAV=false
\`\`\`

**Key Changes Reflected in this README:**

*   Standardized on `TWOCAPTCHA_API_KEY`.
*   Added `EXTENSION_PATHS` for configuring browser extensions.
*   Replaced `SAVE_HTML_ON_FAILURE` with a general `DEBUG` flag. HTML saving for successes is controlled by `SAVE_HTML_ON_SUCCESS_NAV` (and `DEBUG`).
*   Updated module descriptions to reflect changes (e.g., `PluginManager`, `HtmlAnalyser` now uses `document.evaluate`).
*   (Planned/Future) Mention of `HtmlAnalyser.extractDomStructure()`.

## 11. Future Considerations / Advanced Features

(As previously listed: advanced interactions, ML for direct extraction, visual analysis, diverse content types, granular XPaths).
* Implement `HtmlAnalyser.extractDomStructure()` for LLM token optimization.
EOF

echo "Creating smartScraper.dot"
# This will overwrite your existing smartScraper.dot with the content you provided.
mkdir -p ./
cat << 'EOF' > ./smartScraper.dot
digraph SmartScraperFlow {
  rankdir=TB;
  node [shape=box, style="rounded,filled", fillcolor=lightblue, fontname="Helvetica"];
  edge [fontname="Helvetica"];

  // Start and End
  Start [shape=ellipse, fillcolor=lightgreen];
  EndSuccess [shape=ellipse, fillcolor=lightgreen, label="Return Data"];
  EndError [shape=ellipse, fillcolor=salmon, label="Return Error"];

  // Input
  InputURL [label="Input: URL, Proxy (optional), UA (optional)"];

  // Core Engine Decisions
  CheckKnownSite [label="Known Site Check\n(KnownSitesTableManager)"];
  IsConfigValid [label="Config Valid & Not Stale?", shape=diamond, fillcolor=lightyellow];
  
  // Discovery Sub-System
  DiscoveryProcess [label="Unknown Site / Re-Discovery Process", shape= Mrecord, fillcolor=lightgoldenrodyellow,
    label="{Discovery Sub-system | \
      C.1 Initial Probing (cURL, Puppeteer-Stealth) | \
      Detect CAPTCHA (HtmlAnalyser - now HtmlAnalyserFixed) | \
      Compare DOMs (DomComparator) | \
      C.2 Page Prep for XPath Discovery (Puppeteer Interactions) | \
      C.3 DOM Structure Extraction (HtmlAnalyser - Planned) & XPath Discovery (LLMInterface, ContentScoringEngine) | \
      C.4 Outcome of Discovery\nStore New Config (KnownSitesTableManager)\
    }"
  ];
  
  InitialProbeCurl [label="Attempt cURL\n(CurlHandler)"];
  CurlResponse [label="cURL HTML Received?"];
  CheckCaptchaCurl [label="CAPTCHA in cURL HTML?\n(HtmlAnalyser)", shape=diamond, fillcolor=lightyellow];
  
  InitialProbePuppeteer [label="Attempt Puppeteer-Stealth\n(PuppeteerController, PluginManager from EXTENSION_PATHS)"];
  PuppeteerResponse [label="Puppeteer HTML Received?"];
  CheckCaptchaPuppeteer [label="CAPTCHA in Puppeteer HTML?\n(HtmlAnalyser)", shape=diamond, fillcolor=lightyellow];
  
  CompareDOMs [label="Compare cURL & Puppeteer DOMs\n(DomComparator)", shape=diamond, fillcolor=lightyellow];
  
  PreparePageForLLM [label="Prepare Page for LLM\n(Puppeteer Interactions if needed)"];
  ExtractSnippets [label="Extract Snippets/DOM Structure\n(HtmlAnalyser)"]; // DOM Structure is planned
  LLMXPathDiscovery [label="LLM XPath Discovery Loop\n(LLMInterface, HtmlAnalyser, ContentScoringEngine)\nUp to MAX_LLM_RETRIES"];
  XPathFoundLLM [label="XPath Found by LLM?", shape=diamond, fillcolor=lightyellow];
  
  DetermineMethodToStore [label="Determine Method to Store\n(curl, puppeteer_stealth, puppeteer_captcha)"];
  StoreNewConfig [label="Store New Config\n(KnownSitesTableManager)"];

  // Extraction Sub-System
  ExtractionProcess [label="Content Extraction", shape=Mrecord, fillcolor=lightcyan,
    label="{Extraction Sub-system | \
      Method, XPath, CAPTCHA Need Known | \
      D.2 CAPTCHA Handling (CaptchaSolver, DataDomeSolver) if method=puppeteer_captcha | \
      Execute Method (CurlHandler or PuppeteerController) | \
      Extract Content via XPath | \
      Basic Validation\
    }"
  ];
  ExecuteStoredMethod [label="Execute Stored Method\n(CurlHandler or PuppeteerController)"];
  ValidateExtraction [label="Validate Extraction\n(XPath, Content Check)"];
  ExtractionSuccess [label="Extraction Successful?", shape=diamond, fillcolor=lightyellow];
  
  // CAPTCHA Handling
  CaptchaHandling [label="CAPTCHA Handling\n(CaptchaSolver, DataDomeSolver)"];
  CaptchaSolved [label="CAPTCHA Solved?", shape=diamond, fillcolor=lightyellow];

  // HTML Saving (Debug)
  SaveHtmlSuccess [label="Save HTML (Success)\n(if DEBUG=true & SAVE_HTML_ON_SUCCESS_NAV=true)", fillcolor=lightgrey, shape=note];
  SaveHtmlFailure [label="Save HTML (Failure)\n(if DEBUG=true)", fillcolor=lightgrey, shape=note];

  // Connections
  Start -> InputURL;
  InputURL -> CheckKnownSite;
  CheckKnownSite -> IsConfigValid [label="Config Found"];
  CheckKnownSite -> DiscoveryProcess [label="Unknown Site / Re-Discovery Needed"];
  
  IsConfigValid -> ExecuteStoredMethod [label="Yes"];
  IsConfigValid -> DiscoveryProcess [label="No (Stale/Fails)\nIncrement Failure Count"];
  
  ExecuteStoredMethod -> ValidateExtraction;
  ValidateExtraction -> ExtractionSuccess;
  ExtractionSuccess -> UpdateSuccessStats [label="Yes"];
  UpdateSuccessStats [label="Update Success Stats\n(KnownSitesTableManager)"];
  UpdateSuccessStats -> SaveHtmlSuccess;
  SaveHtmlSuccess -> EndSuccess;
  
  ExtractionSuccess -> IncrementFailureAndRediscover [label="No"];
  IncrementFailureAndRediscover [label="Increment Failure Count\n(KnownSitesTableManager)"];
  IncrementFailureAndRediscover -> DiscoveryProcess;

  // Discovery Process Details
  DiscoveryProcess -> InitialProbeCurl;
  InitialProbeCurl -> CurlResponse;
  CurlResponse -> CheckCaptchaCurl [label="Success"];
  CurlResponse -> InitialProbePuppeteer [label="Fail (or proceed to Puppeteer anyway)"];
  
  CheckCaptchaCurl -> InitialProbePuppeteer [label="No CAPTCHA"]; // Or proceed to DOM comparison if Puppeteer also runs
  CheckCaptchaCurl -> CaptchaHandling [label="Yes (DataDome?)\nSkip Puppeteer-Stealth"]; // Path to direct CAPTCHA solving
  CaptchaHandling -> InitialProbePuppeteer [label="CAPTCHA Not Solved / Other CAPTCHA"]; // Fallback or if general CAPTCHA
  CaptchaHandling -> PreparePageForLLM [label="DataDome Solved by Puppeteer"];


  InitialProbePuppeteer -> PuppeteerResponse;
  PuppeteerResponse -> CheckCaptchaPuppeteer [label="Success"];
  PuppeteerResponse -> CompareDOMs [label="Fail (use cURL if available)"]; // Or error if cURL also failed

  // Simplified flow after probes for diagram clarity
  CheckCaptchaPuppeteer -> CompareDOMs [label="No CAPTCHA"];
  CheckCaptchaPuppeteer -> CaptchaHandling [label="Yes (DataDome?)\nUse Puppeteer"];
  
  CompareDOMs -> PreparePageForLLM [label="Choose HTML for Analysis\n(cURL or Puppeteer)"];
  // If cURL HTML chosen and Puppeteer was used for probing, Puppeteer instance might be closed here.
  
  PreparePageForLLM -> ExtractSnippets;
  ExtractSnippets -> LLMXPathDiscovery;
  LLMXPathDiscovery -> XPathFoundLLM;
  
  XPathFoundLLM -> DetermineMethodToStore [label="Yes"];
  DetermineMethodToStore -> StoreNewConfig;
  StoreNewConfig -> ExtractionProcess [label="Proceed to Extract"];
  
  XPathFoundLLM -> SaveHtmlFailure [label="No (Discovery Failed)"];
  SaveHtmlFailure -> EndError [label="Discovery Failed"];

  // Extraction Process Details
  ExtractionProcess -> CaptchaHandling [label="If method=puppeteer_captcha"];
  CaptchaHandling -> ExecuteExtractionMethod [label="Solved"];
  CaptchaHandling -> SaveHtmlFailure [label="Not Solved"]; 

  ExtractionProcess -> ExecuteExtractionMethod [label="If method != puppeteer_captcha"];
  ExecuteExtractionMethod [label="Execute Method & Extract Content"];
  ExecuteExtractionMethod -> ExtractionSuccessFromDiscovery [label="Content Extracted"];
  ExtractionSuccessFromDiscovery [label="Extraction Successful?", shape=diamond, fillcolor=lightyellow];
  ExtractionSuccessFromDiscovery -> SaveHtmlSuccess [label="Yes"];
  ExtractionSuccessFromDiscovery -> SaveHtmlFailure [label="No (Extraction Failed)"];
  
  // General Error Path
  DiscoveryProcess -> SaveHtmlFailure [label="Critical Error During Discovery"];
  ExtractionProcess -> SaveHtmlFailure [label="Critical Error During Extraction"];
  SaveHtmlFailure -> EndError; 
}
EOF

echo "Shar archive extraction complete for specified files."
echo "IMPORTANT: After running this script, manually delete the file 'analysis/html-analyser.js' from your project."
echo "Then, thoroughly test the changes."

exit 0
