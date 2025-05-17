// src/core/engine.js
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url'; // For robust URL parsing, especially for filenames

import { KnownSitesManager } from '../storage/known-sites-manager.js';
import { PuppeteerController } from '../browser/puppeteer-controller.js';
import { PluginManager } from '../browser/plugin-manager.js';
import { fetchWithCurl } from '../network/curl-handler.js';
import { HtmlAnalyserFixed as HtmlAnalyser } from '../analysis/html-analyser-fixed.js'; // SWITCHED
import { DomComparator } from '../analysis/dom-comparator.js';
import { ContentScoringEngine } from '../analysis/content-scoring-engine.js';
import { LLMInterface } from '../services/llm-interface.js';
import { CaptchaSolver } from '../services/captcha-solver.js';
import { logger } from '../utils/logger.js';
import { normalizeDomain, isValidUrl } from '../utils/url-helpers.js';
import { METHODS, OUTPUT_TYPES } from '../constants.js';
import { allConfigs } from '../../config/index.js';
import { ScraperError, NetworkError, ExtractionError, ConfigurationError, CaptchaError, LLMError } from '../utils/error-handler.js';

class CoreScraperEngine {
  constructor(configs = allConfigs) {
    this.configs = configs;
    this.knownSitesManager = new KnownSitesManager(this.configs.scraper.knownSitesStoragePath);
    this.pluginManager = new PluginManager(this.configs.scraper.extensionPaths); // Pass extension paths if configured
    this.puppeteerController = new PuppeteerController(this.pluginManager, this.configs.scraper);
    this.htmlAnalyser = new HtmlAnalyser(); // Now refers to HtmlAnalyserFixed
    this.domComparator = new DomComparator(this.configs.scraper.domComparisonThreshold);
    this.contentScoringEngine = new ContentScoringEngine(
      this.configs.scraper.scoreWeights,
      this.configs.scraper.minParagraphThreshold,
      this.configs.scraper.descriptiveKeywords, // Pass general descriptive keywords
      this.configs.scraper.contentIdKeywordsRegex, // Pass specific ID regex
      this.configs.scraper.contentClassKeywordsRegex // Pass specific class regex
    );
    this.llmInterface = new LLMInterface(this.configs.llm);
    this.captchaSolver = new CaptchaSolver(this.configs.captchaSolver, this.knownSitesManager);

    logger.info('CoreScraperEngine initialized with HtmlAnalyserFixed (as HtmlAnalyser) and enhanced ContentScoringEngine.');
  }

  async _saveDebugHtml(type, domain, urlString, htmlContent) {
    if (!this.configs.scraper.debug || typeof htmlContent !== 'string' || !htmlContent.trim()) {
      if (this.configs.scraper.debug && (typeof htmlContent !== 'string' || !htmlContent.trim())) {
        logger.debug(`[DEBUG] Not saving HTML for ${urlString}: HTML content is empty or not a string.`);
      }
      return;
    }
    if (type === 'success' && !this.configs.scraper.saveHtmlOnSuccessNav) {
      logger.debug(`[DEBUG] Conditions not met to save 'success' HTML for ${urlString}. SaveOnSuccessNav: ${this.configs.scraper.saveHtmlOnSuccessNav}`);
      return;
    }

    const dumpDir = type === 'failure' ? this.configs.scraper.failedHtmlDumpsPath : this.configs.scraper.successHtmlDumpsPath;
    try {
      await fs.mkdir(dumpDir, { recursive: true });
      const parsedUrl = new URL(urlString);
      // Sanitize pathname to create a valid filename component
      const safePathname = parsedUrl.pathname.replace(/^\//, '').replace(/\/$/, '') // Remove leading/trailing slashes
        .replace(/\//g, '_') // Replace remaining slashes with underscores
        .replace(/[^a-zA-Z0-9_.-]/g, '_').substring(0, 100);
      const safeHostname = parsedUrl.hostname.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const filename = `${safeHostname}${safePathname ? '_' + safePathname : ''}_${type}_${Date.now()}.html`;

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

    if (!domain) {
      const errorMsg = `Invalid URL or could not normalize domain: ${targetUrl}`;
      logger.error(errorMsg);
      throw new ConfigurationError(errorMsg, { url: targetUrl });
    }

    const effectiveProxy = proxyDetails || (this.configs.proxy.httpProxy ? { server: this.configs.proxy.httpProxy, type: 'http' } : null);
    if (effectiveProxy && !proxyDetails) {
        logger.info(`Using default proxy from HTTP_PROXY environment variable for ${targetUrl}`);
    }
    const effectiveUserAgent = userAgentString || this.configs.scraper.defaultUserAgent;

    let siteConfig = await this.knownSitesManager.getConfig(domain);
    let errorHtml = ''; // To store HTML content in case of error

    try {
      if (siteConfig) {
        logger.info(`Found known site config for domain: ${domain}`);
        const knownScrapeResult = await this._scrapeWithKnownConfig(targetUrl, siteConfig, effectiveProxy, effectiveUserAgent, requestedOutput);
        if (knownScrapeResult !== null) { // Check for explicit null which indicates failure
          return knownScrapeResult;
        }
        // If knownScrapeResult is null, it means scraping with known config failed.
        logger.warn(`Scraping with known config failed for ${domain}. Triggering re-discovery.`);
        await this.knownSitesManager.incrementFailure(domain);
        // Fall through to discovery
        siteConfig = null; // Treat as unknown now
      }

      // If no siteConfig or if known config failed:
      logger.info(`No known site config for domain: ${domain} or known config failed. Starting discovery.`);
      const discoveryResult = await this._discoverAndScrape(targetUrl, domain, effectiveProxy, effectiveUserAgent, requestedOutput);
      return discoveryResult;

    } catch (error) {
      logger.error(`${error.name || 'Error'} during main scrape for ${targetUrl}: ${error.message}`, error.details || error.stack);
      errorHtml = error.htmlContent || (error.details && error.details.htmlContent) || '';
      await this._saveDebugHtml('failure', domain, targetUrl, errorHtml);

      // Re-throw as a generic ScraperError or a more specific one if identifiable
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
          if (!curlResponse.success) {
            pageContent = curlResponse.html; // Save HTML even on failure
            throw new NetworkError(`cURL fetch failed for known config: ${curlResponse.error}`, { htmlContent: pageContent });
          }
          pageContent = curlResponse.html;
          break;
        case METHODS.PUPPETEER_STEALTH:
          ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, userAgent, config.puppeteer_wait_conditions));
          pageContent = await this.puppeteerController.getPageContent(page);
          break;
        case METHODS.PUPPETEER_CAPTCHA:
          ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, userAgent, config.puppeteer_wait_conditions));
          const captchaSolved = await this.captchaSolver.solveIfPresent(page, url);
          if (!captchaSolved) {
            pageContent = await this.puppeteerController.getPageContent(page).catch(() => null);
            throw new CaptchaError('CAPTCHA solving failed or CAPTCHA not found as expected for known config.', { htmlContent: pageContent });
          }
          await page.waitForTimeout(this.configs.scraper.puppeteerPostLoadDelay); // Allow page to settle after CAPTCHA
          pageContent = await this.puppeteerController.getPageContent(page);
          break;
        default:
          throw new ConfigurationError(`Unknown method in site config: ${config.method}`);
      }

      if (!pageContent) {
        throw new ExtractionError('Failed to retrieve page content with known config.', { htmlContent: pageContent });
      }

      await this.knownSitesManager.updateSuccess(config.domain_pattern);
      await this._saveDebugHtml('success', config.domain_pattern, url, pageContent);

      if (requestedOutput === OUTPUT_TYPES.FULL_HTML) {
        return { success: true, data: pageContent, method: config.method, xpath: config.xpath_main_content };
      }

      let extractedElementHtml;
      if (config.method === METHODS.CURL) {
        extractedElementHtml = this.htmlAnalyser.extractByXpath(pageContent, config.xpath_main_content);
      } else { // Puppeteer methods
        const elements = await page.$x(config.xpath_main_content);
        if (elements.length > 0) {
          extractedElementHtml = await page.evaluate(el => el.innerHTML, elements[0]);
          for (const el of elements) await el.dispose(); // Clean up element handles
        } else {
          extractedElementHtml = null;
        }
      }

      if (!extractedElementHtml) {
        throw new ExtractionError(`XPath ${config.xpath_main_content} did not yield content with known config.`, { htmlContent: pageContent });
      }
      return { success: true, data: extractedElementHtml, method: config.method, xpath: config.xpath_main_content };

    } catch (error) {
      logger.error(`${error.name || 'Error'} scraping with known config for ${url}: ${error.message}`, error.details);
      await this._saveDebugHtml('failure', config.domain_pattern, url, pageContent || (error.details && error.details.htmlContent) || '');
      // Return null to indicate failure to the main scrape method, so it can trigger re-discovery
      return null;
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
    let htmlForAnalysis = null;
    let curlHtml = null;
    let puppeteerHtml = null;
    let tentativeMethodIsCurl = false;
    let discoveredNeedsCaptcha = false;

    try {
      // Step 1: Initial Probing (cURL and/or Puppeteer)
      const curlResponse = await fetchWithCurl(url, proxyDetails, null, userAgent).catch(e => e); // Catch to prevent immediate throw

      if (curlResponse && curlResponse.success) {
        curlHtml = curlResponse.html;
        if (this.htmlAnalyser.detectCaptchaMarkers(curlHtml)) {
          logger.info('CAPTCHA detected in cURL response.');
          discoveredNeedsCaptcha = true;
          if (curlHtml.includes('captcha-delivery.com') || curlHtml.includes('geo.captcha-delivery.com')) {
            logger.info('DataDome CAPTCHA detected in cURL response. Prioritizing CAPTCHA solving flow with Puppeteer.');
            ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, userAgent));
            const captchaSolved = await this.captchaSolver.solveIfPresent(page, url);
            if (!captchaSolved) {
              puppeteerHtml = await this.puppeteerController.getPageContent(page).catch(() => null);
              throw new CaptchaError('DataDome CAPTCHA solving failed during discovery.', { htmlContent: puppeteerHtml || curlHtml });
            }
            puppeteerHtml = await this.puppeteerController.getPageContent(page);
            htmlForAnalysis = puppeteerHtml; // Use Puppeteer's HTML after CAPTCHA
            tentativeMethodIsCurl = false;
          } else {
            // Other CAPTCHA, might still try Puppeteer without immediate solving
            htmlForAnalysis = curlHtml; // Temporarily use cURL HTML for analysis, Puppeteer might be needed later
            tentativeMethodIsCurl = true;
          }
        } else {
          htmlForAnalysis = curlHtml;
          tentativeMethodIsCurl = true;
        }
      } else {
        logger.warn(`cURL fetch failed for ${url}: ${curlResponse.error || curlResponse.message}`);
        // Fallback to Puppeteer if cURL fails
      }

      if (!htmlForAnalysis || discoveredNeedsCaptcha) { // If cURL failed, or CAPTCHA means we need Puppeteer anyway
        if (!page) { // If Puppeteer wasn't launched for DataDome
          ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, userAgent, null, true /* isInitialProbe */));
        }
        puppeteerHtml = await this.puppeteerController.getPageContent(page);
        if (this.htmlAnalyser.detectCaptchaMarkers(puppeteerHtml)) {
          logger.info('CAPTCHA detected in Puppeteer probe response.');
          discoveredNeedsCaptcha = true;
          const captchaSolved = await this.captchaSolver.solveIfPresent(page, url);
          if (!captchaSolved) {
            throw new CaptchaError('CAPTCHA solving failed during Puppeteer probe.', { htmlContent: puppeteerHtml });
          }
          puppeteerHtml = await this.puppeteerController.getPageContent(page); // Get fresh content
        }
        htmlForAnalysis = puppeteerHtml;
        tentativeMethodIsCurl = false; // Puppeteer was used
      }

      if (!htmlForAnalysis) {
        throw new NetworkError('Failed to retrieve any HTML content for analysis.');
      }

      // Step 2: DOM Comparison (if both were fetched and no CAPTCHA forced Puppeteer)
      if (curlHtml && puppeteerHtml && !discoveredNeedsCaptcha) {
        const areSimilar = await this.domComparator.compareDoms(curlHtml, puppeteerHtml);
        if (areSimilar) {
          logger.info('cURL and Puppeteer DOMs are similar. Prioritizing cURL for analysis.');
          htmlForAnalysis = curlHtml;
          tentativeMethodIsCurl = true;
          if (page) { await this.puppeteerController.cleanupPuppeteer(browser); browser = null; page = null; }
        } else {
          logger.info('DOMs differ. Using Puppeteer output for analysis.');
          htmlForAnalysis = puppeteerHtml;
          tentativeMethodIsCurl = false;
        }
      } else if (curlHtml && !puppeteerHtml) {
        logger.info('Using cURL output (Puppeteer probe failed or not needed).');
        htmlForAnalysis = curlHtml;
        tentativeMethodIsCurl = true;
      } else if (puppeteerHtml) {
        logger.info('Using Puppeteer output (cURL failed or CAPTCHA indicated Puppeteer).');
        htmlForAnalysis = puppeteerHtml;
        tentativeMethodIsCurl = false;
      }
      // If page still exists and we are using Puppeteer HTML, perform full interactions
      if (!tentativeMethodIsCurl && page && !page.isClosed()) {
          logger.debug('Performing full interactions on Puppeteer page for discovery.');
          await this.puppeteerController.performInteractions(page);
          const freshPuppeteerHtml = await this.puppeteerController.getPageContent(page);
          if (this.htmlAnalyser.detectCaptchaMarkers(freshPuppeteerHtml) && !discoveredNeedsCaptcha) {
              logger.info('CAPTCHA detected after full Puppeteer load during discovery. Attempting solve.');
              discoveredNeedsCaptcha = true;
              const captchaSolved = await this.captchaSolver.solveIfPresent(page, url);
              if (!captchaSolved) throw new CaptchaError('CAPTCHA solving failed after full load.',{htmlContent: freshPuppeteerHtml});
              htmlForAnalysis = await this.puppeteerController.getPageContent(page);
          } else if (freshPuppeteerHtml) {
              htmlForAnalysis = freshPuppeteerHtml;
          }
      }


      // Step 3: LLM XPath Discovery
      logger.info('Preparing simplified DOM for LLM...');
      const simplifiedDomForLlm = this.htmlAnalyser.extractDomStructure(htmlForAnalysis);
      const snippets = this.htmlAnalyser.extractArticleSnippets(htmlForAnalysis);
      let foundXPath = null;
      let bestScore = -Infinity;
      let llmFeedback = [];
      let bestCandidateDetails = null;

      for (let i = 0; i < this.configs.scraper.maxLlmRetries; i++) {
        logger.info(`LLM attempt ${i + 1}/${this.configs.scraper.maxLlmRetries} for ${url}`);
        const candidateXPaths = await this.llmInterface.getCandidateXPaths(simplifiedDomForLlm, snippets, llmFeedback);

        if (!candidateXPaths || candidateXPaths.length === 0) {
          llmFeedback.push("LLM returned no candidate XPaths.");
          logger.warn("LLM returned no candidates on attempt " + (i+1));
          if (i === this.configs.scraper.maxLlmRetries - 1) break; // Last attempt
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait before retrying
          continue;
        }

        let currentAttemptBestXPath = null;
        let currentAttemptBestScore = -Infinity;
        let currentAttemptDetails = null;
        const attemptFeedback = [];

        for (const xpath of candidateXPaths) {
          const details = tentativeMethodIsCurl ?
            this.htmlAnalyser.queryStaticXPathWithDetails(htmlForAnalysis, xpath) :
            await this.puppeteerController.queryXPathWithDetails(page, xpath);

          if (details.element_found_count === 0) {
            attemptFeedback.push({ xpath, result: `Found 0 elements.` });
            continue;
          }
          const score = this.contentScoringEngine.scoreElement(details); // `details` now includes `xpath`
          attemptFeedback.push({ xpath, result: `Score ${score.toFixed(2)} (P:${details.paragraphCount || 0}, TL:${details.textContentLength || 0}, Found:${details.element_found_count})` });


          if (score > currentAttemptBestScore) {
            currentAttemptBestScore = score;
            currentAttemptBestXPath = xpath;
            currentAttemptDetails = details;
          }
        }
        llmFeedback = attemptFeedback.sort((a,b) => parseFloat(b.result.match(/Score (-?\d+\.?\d*)/)?.[1] || -Infinity) - parseFloat(a.result.match(/Score (-?\d+\.?\d*)/)?.[1] || -Infinity) ).slice(0,5);


        if (currentAttemptBestXPath && currentAttemptBestScore > bestScore) {
          bestScore = currentAttemptBestScore;
          foundXPath = currentAttemptBestXPath;
          bestCandidateDetails = currentAttemptDetails;
          logger.info(`New best XPath from attempt ${i+1}: ${foundXPath} with score: ${bestScore.toFixed(2)}`);
        }
        
        if (bestScore >= this.configs.scraper.minXpathScoreThreshold) {
            logger.info(`Sufficiently good XPath found with score ${bestScore.toFixed(2)}. Stopping LLM attempts.`);
            break; 
        }
        if (i < this.configs.scraper.maxLlmRetries - 1 && candidateXPaths.length > 0) {
             logger.info(`Score ${bestScore.toFixed(2)} is below threshold ${this.configs.scraper.minXpathScoreThreshold}. Retrying with feedback.`);
             await new Promise(resolve => setTimeout(resolve, 1500)); // Wait before next attempt
        }
      }

      if (!foundXPath || bestScore < this.configs.scraper.minXpathScoreThreshold) {
        await this._saveDebugHtml('failure', domain, url, htmlForAnalysis);
        logger.error(`XPath discovery failed for ${url} after all retries or score too low (${bestScore.toFixed(2)}).`);
        throw new ExtractionError('XPath discovery failed or score too low.', {htmlContent: htmlForAnalysis, bestScore: bestScore, llmFeedback});
      }

      // Step 4: Determine Method and Save Config
      let methodToStore;
      if (discoveredNeedsCaptcha) {
        methodToStore = METHODS.PUPPETEER_CAPTCHA;
      } else if (tentativeMethodIsCurl) {
        // Re-validate XPath on cURL HTML if it was chosen for analysis
        const curlValidationContent = this.htmlAnalyser.extractByXpath(curlHtml, foundXPath);
        if (!curlValidationContent) {
          logger.warn(`XPath ${foundXPath} found via cURL analysis but failed re-validation on cURL HTML. Switching to Puppeteer method for ${domain}.`);
          methodToStore = METHODS.PUPPETEER_STEALTH; // Or _CAPTCHA if discoveredNeedsCaptcha was true earlier
          // If Puppeteer wasn't used, we might need to launch it now to confirm XPath, or just save as PUPPETEER_STEALTH
          // For simplicity, if cURL re-validation fails, assume Puppeteer would work.
          if (!page && !browser) { // If Puppeteer was never launched
             logger.info("Launching Puppeteer for final validation as cURL re-validation failed.");
             // This path is less common if initial probing was thorough
             // For now, we'll assume if cURL re-validation fails, PUPPETEER_STEALTH is the choice.
          }
        } else {
          methodToStore = METHODS.CURL;
        }
      } else {
        methodToStore = METHODS.PUPPETEER_STEALTH;
      }

      const newConfig = {
        domain_pattern: domain,
        method: methodToStore,
        xpath_main_content: foundXPath,
        last_successful_scrape_timestamp: new Date().toISOString(), // Mark as successful now
        failure_count_since_last_success: 0,
        site_specific_headers: null, // Can be enhanced later
        user_agent_to_use: userAgent,
        needs_captcha_solver: discoveredNeedsCaptcha,
        puppeteer_wait_conditions: null, // Can be enhanced later
        discovered_by_llm: true
      };
      await this.knownSitesManager.saveConfig(domain, newConfig);
      logger.info(`New config saved for ${domain}. Method: ${methodToStore}, XPath: ${foundXPath}`);

      // Step 5: Scrape with the newly discovered config
      // Save HTML from the analysis phase if it's a success
      await this._saveDebugHtml('success', domain, url, htmlForAnalysis);
      const finalResult = await this._scrapeWithKnownConfig(url, newConfig, proxyDetails, userAgent, requestedOutput);
      if (finalResult === null) { // Should not happen if we just saved it and it worked
          throw new ExtractionError("Scraping with newly discovered config failed unexpectedly.", {htmlContent: htmlForAnalysis});
      }
      return finalResult;

    } catch (error) {
      logger.error(`${error.name || 'Error'} during discovery/scrape for ${url}: ${error.message}`, error.details);
      const errorHtmlContent = htmlForAnalysis || (error.details && error.details.htmlContent) || '';
      await this._saveDebugHtml('failure', domain, url, errorHtmlContent);

      if (error instanceof ScraperError) throw error;
      throw new ScraperError(`Discovery and scraping failed for ${url}: ${error.message}`, { originalError: error, htmlContent: errorHtmlContent });
    } finally {
      if (browser) {
        await this.puppeteerController.cleanupPuppeteer(browser);
      }
    }
  }
}

export { CoreScraperEngine };
