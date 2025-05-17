// src/core/engine.js
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url'; // For robust URL parsing, especially for filenames

import { KnownSitesManager } from '../storage/known-sites-manager.js';
import { PuppeteerController } from '../browser/puppeteer-controller.js';
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
          for (const el of elements) await el.dispose(); 
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
        if (discoveredNeedsCaptcha || (bestCandidateDetails && bestCandidateDetails.isCaptchaPage)) { 
          methodToStore = METHODS.PUPPETEER_CAPTCHA;
        }
        
        if (methodToStore === METHODS.CURL && discoveredNeedsCaptcha) {
            logger.warn(`Initial method was cURL, but CAPTCHA detected. Switching to puppeteer_captcha for ${domain}`);
            methodToStore = METHODS.PUPPETEER_CAPTCHA;
        }
        if (methodToStore === METHODS.CURL && curlHtml) { 
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
