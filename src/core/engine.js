// src/core/engine.js

import { KnownSitesManager } from '../storage/known-sites-manager.js';
import { PuppeteerController } from '../browser/puppeteer-controller.js';
import { PluginManager } from '../browser/plugin-manager.js'; // Assuming you have this
import { fetchWithCurl } from '../network/curl-handler.js';
import { HtmlAnalyser } from '../analysis/html-analyser.js';
import { DomComparator } from '../analysis/dom-comparator.js';
import { ContentScoringEngine } from '../analysis/content-scoring-engine.js';
import { LLMInterface } from '../services/llm-interface.js';
import { CaptchaSolver } from '../services/captcha-solver.js';
import logger from '../utils/logger.js'; // Assuming a logger utility
import { normalizeDomain } from '../utils/url-helpers.js';
import {
    ScraperError,
    LLMError,
    CaptchaError,
    NetworkError,
    ConfigurationError,
    ExtractionError
} from '../utils/error-handler.js';
import { scraperSettings, llmConfig, captchaSolverConfig } from '../../config/index.js'; // Import all configs

const { METHODS } = await import('../constants.js'); // Assuming constants.js exports METHODS

class CoreScraperEngine {
    constructor(customConfigs = {}) {
        // Allow overriding default configs for testing or specific instances
        this.configs = {
            scraper: { ...scraperSettings, ...(customConfigs.scraperSettings || {}) },
            llm: { ...llmConfig, ...(customConfigs.llmConfig || {}) },
            captchaSolver: { ...captchaSolverConfig, ...(customConfigs.captchaSolverConfig || {}) },
        };

        // Instantiate modules
        this.knownSitesManager = new KnownSitesManager(this.configs.scraper.knownSitesStoragePath || './data/known_sites_storage.json');
        this.pluginManager = new PluginManager(); // Or pass configs if needed
        this.puppeteerController = new PuppeteerController(this.pluginManager, this.configs.scraper);
        this.htmlAnalyser = new HtmlAnalyser();
        this.domComparator = new DomComparator(this.configs.scraper.domComparisonThreshold);
        this.contentScoringEngine = new ContentScoringEngine(this.configs.scraper.scoreWeights, this.configs.scraper.minParagraphThreshold, this.configs.scraper.tagsToCount, this.configs.scraper.unwantedTags, this.configs.scraper.descriptiveIdOrClassKeywords);
        this.llmInterface = new LLMInterface(this.configs.llm);
        this.captchaSolver = new CaptchaSolver(this.configs.captchaSolver);

        logger.info('CoreScraperEngine initialized.');
    }

    async scrape(targetUrl, proxyDetails = null, userAgentString = null, requestedOutput = 'content') {
        logger.info(`Starting scrape for URL: ${targetUrl}`);
        const domain = normalizeDomain(targetUrl);
        if (!domain) {
            logger.error(`Invalid URL or unable to extract domain: ${targetUrl}`);
            return { success: false, error: 'Invalid URL', data: null };
        }

        let siteConfig = await this.knownSitesManager.getConfig(domain);
        let effectiveUserAgent = userAgentString || (siteConfig ? siteConfig.user_agent_to_use : null) || this.configs.scraper.defaultUserAgent;

        if (siteConfig) {
            logger.info(`Found known site config for domain: ${domain}`);
            if (this._isConfigStale(siteConfig)) {
                logger.warn(`Config for ${domain} is stale. Triggering re-discovery.`);
                siteConfig = null; // Force re-discovery
            } else {
                // Attempt with known config
                const knownScrapeResult = await this._scrapeWithKnownConfig(targetUrl, siteConfig, proxyDetails, effectiveUserAgent, requestedOutput);
                if (knownScrapeResult.success) {
                    return knownScrapeResult;
                }
                logger.warn(`Scraping with known config failed for ${domain}. Triggering re-discovery.`);
                await this.knownSitesManager.incrementFailure(domain);
                // Fall through to re-discovery
            }
        } else {
            logger.info(`No known site config for domain: ${domain}. Starting discovery.`);
        }

        // Unknown site or re-discovery
        const discoveryResult = await this._discoverAndScrape(targetUrl, domain, proxyDetails, effectiveUserAgent, requestedOutput, siteConfig /* old config as hint */);
        return discoveryResult;
    }

    _isConfigStale(siteConfig) {
        if (!siteConfig) return true;
        if (siteConfig.failure_count_since_last_success >= this.configs.scraper.maxFailuresBeforeRediscovery) {
            return true;
        }
        if (siteConfig.last_successful_scrape_timestamp) {
            const lastSuccessDate = new Date(siteConfig.last_successful_scrape_timestamp);
            const stalenessDuration = this.configs.scraper.stalenessDurationDays * 24 * 60 * 60 * 1000;
            if (Date.now() - lastSuccessDate.getTime() > stalenessDuration) {
                return true;
            }
        }
        return false;
    }

    async _scrapeWithKnownConfig(url, config, proxyDetails, userAgent, requestedOutput) {
        logger.info(`Attempting scrape with known config for: ${url} using method: ${config.method}`);
        let pageContent = null;
        let browser = null;
        let page = null;

        try {
            if (config.method === METHODS.CURL) {
                const curlResponse = await fetchWithCurl(url, proxyDetails, config.site_specific_headers, userAgent);
                if (curlResponse.success) {
                    pageContent = curlResponse.html;
                } else {
                    throw new Error(`cURL fetch failed: ${curlResponse.error}`);
                }
            } else if (config.method === METHODS.PUPPETEER_STEALTH || config.method === METHODS.PUPPETEER_CAPTCHA) {
                ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, userAgent, config.puppeteer_wait_conditions));

                if (config.method === METHODS.PUPPETEER_CAPTCHA && config.needs_captcha_solver) {
                    const captchaSolved = await this.captchaSolver.solveIfPresent(page, url); // solveIfPresent needs to be smart
                    if (!captchaSolved) {
                        throw new Error('CAPTCHA solving failed or CAPTCHA not found as expected.');
                    }
                    // Potentially re-wait or re-evaluate page state after CAPTCHA
                    await page.waitForTimeout(this.configs.scraper.puppeteerPostLoadDelay); // Generic wait
                }
                pageContent = await this.puppeteerController.getPageContent(page);
            } else {
                throw new Error(`Unknown method in site config: ${config.method}`);
            }

            if (!pageContent) {
                throw new Error('Failed to retrieve page content.');
            }

            if (requestedOutput === 'full_html') {
                await this.knownSitesManager.updateSuccess(config.domain_pattern);
                return { success: true, data: pageContent, method: config.method, xpath: config.xpath_main_content };
            }

            // Extract content using XPath
            // For cURL, we'd need a static HTML parser to evaluate XPath
            // For Puppeteer, page.$x can be used.
            // This part needs a unified way to query XPath on either raw HTML or a Puppeteer page.
            // Let's assume puppeteerController.queryXPathWithDetails can handle raw HTML too, or we have a separate utility.
            let extractedElementHtml = null;
            if (page) { // Puppeteer context
                 const elements = await page.$x(config.xpath_main_content);
                 if (elements.length > 0) {
                    extractedElementHtml = await page.evaluate(el => el.innerHTML, elements[0]);
                    await elements[0].dispose(); // Dispose of element handle
                 }
            } else { // cURL context (raw HTML) - needs a DOM parser like JSDOM + XPath evaluator
                // Placeholder for static HTML XPath extraction
                extractedElementHtml = this.htmlAnalyser.extractByXpath(pageContent, config.xpath_main_content);
                if (!extractedElementHtml) logger.warn(`Static XPath extraction failed for ${url}`);
            }


            if (extractedElementHtml) {
                await this.knownSitesManager.updateSuccess(config.domain_pattern);
                return { success: true, data: extractedElementHtml, method: config.method, xpath: config.xpath_main_content };
            } else {
                throw new Error(`XPath ${config.xpath_main_content} did not yield content.`);
            }

        } catch (error) {
            // Log the error with appropriate detail based on type
            if (error instanceof ScraperError) {
                logger.error(`${error.name} while scraping with known config for ${url}: ${error.message}`, error.details);
            } else {
                logger.error(`Error scraping with known config for ${url}: ${error.message}`);
            }

            // Create a structured error response with appropriate details
            const errorResponse = {
                success: false,
                data: null,
                error: error.message
            };

            // Add more specific error details based on error type
            if (error instanceof NetworkError) {
                errorResponse.errorType = 'network';
                errorResponse.errorDetails = error.details;
            } else if (error instanceof CaptchaError) {
                errorResponse.errorType = 'captcha';
                errorResponse.errorDetails = error.details;
            } else if (error instanceof ExtractionError) {
                errorResponse.errorType = 'extraction';
                errorResponse.errorDetails = error.details;
            } else if (error instanceof LLMError) {
                errorResponse.errorType = 'llm';
                errorResponse.errorDetails = error.details;
            } else if (error instanceof ConfigurationError) {
                errorResponse.errorType = 'configuration';
                errorResponse.errorDetails = error.details;
            }

            return errorResponse;
        } finally {
            if (browser) {
                await this.puppeteerController.cleanupPuppeteer(browser);
            }
        }
    }

    async _discoverAndScrape(url, domain, proxyDetails, userAgent, requestedOutput, oldConfigHint = null) {
        logger.info(`Starting content discovery for ${url}`);
        let discoveredNeedsCaptcha = false;
        let curlHtml = null;
        let puppeteerHtml = null;
        let tentativeMethodIsCurl = false;
        let htmlForAnalysis = null;
        let browser = null;
        let page = null;

        try {
            // C.1. Initial Probing
            const curlResponse = await fetchWithCurl(url, proxyDetails, null, userAgent);
            if (curlResponse.success) {
                curlHtml = curlResponse.html;
                if (this.htmlAnalyser.detectCaptchaMarkers(curlHtml)) {
                    discoveredNeedsCaptcha = true;
                    logger.info('CAPTCHA detected in cURL response.');
                }
            } else {
                logger.warn(`cURL fetch failed for ${url}: ${curlResponse.error}`);
            }

            // Always try Puppeteer for comparison and as fallback
            try {
                ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, userAgent, null, true /*isInitialProbe*/));
                puppeteerHtml = await this.puppeteerController.getPageContent(page);
                if (this.htmlAnalyser.detectCaptchaMarkers(puppeteerHtml)) {
                    discoveredNeedsCaptcha = true;
                    logger.info('CAPTCHA detected in Puppeteer probe response.');
                }
            } catch (probeError) {
                 logger.error(`Initial Puppeteer probe failed for ${url}: ${probeError.message}`);
                 if (!curlHtml) throw new Error('Both cURL and initial Puppeteer probe failed.'); // Critical failure
                 // Proceed with cURL HTML if available
            }


            if (curlHtml && puppeteerHtml) {
                const areSimilar = await this.domComparator.compareDoms(curlHtml, puppeteerHtml);
                if (areSimilar && !discoveredNeedsCaptcha) { // If CAPTCHA, Puppeteer is likely needed anyway
                    tentativeMethodIsCurl = true;
                    htmlForAnalysis = curlHtml;
                    logger.info('cURL and Puppeteer DOMs are similar. Prioritizing cURL for analysis.');
                    if (page) { await this.puppeteerController.cleanupPuppeteer(browser); browser = null; page = null; } // Close probe browser
                } else {
                    htmlForAnalysis = puppeteerHtml;
                    logger.info('DOMs differ or CAPTCHA present. Using Puppeteer output for analysis.');
                }
            } else if (puppeteerHtml) {
                htmlForAnalysis = puppeteerHtml;
                logger.info('Using Puppeteer output for analysis (cURL failed or not available).');
            } else if (curlHtml) { // Puppeteer probe failed, but cURL worked
                tentativeMethodIsCurl = true;
                htmlForAnalysis = curlHtml;
                logger.info('Using cURL output for analysis (Puppeteer probe failed).');
            } else {
                throw new Error('Failed to retrieve any HTML content for analysis.');
            }

            // C.2. Page Preparation for XPath Discovery (if Puppeteer HTML is used)
            if (!tentativeMethodIsCurl && !page) { // Need a "full" Puppeteer page if probe was closed or failed
                ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, userAgent));
                htmlForAnalysis = await this.puppeteerController.getPageContent(page); // Get fresh content after interactions
                if (this.htmlAnalyser.detectCaptchaMarkers(htmlForAnalysis) && !discoveredNeedsCaptcha) {
                    discoveredNeedsCaptcha = true; // Re-check
                    logger.info('CAPTCHA detected after full Puppeteer load.');
                }
            } else if (!tentativeMethodIsCurl && page) { // Probe page is still open, use it
                 await this.puppeteerController.performInteractions(page); // Scroll, mouse move
                 await page.waitForTimeout(this.configs.scraper.puppeteerPostLoadDelay);
                 htmlForAnalysis = await this.puppeteerController.getPageContent(page);
                 if (this.htmlAnalyser.detectCaptchaMarkers(htmlForAnalysis) && !discoveredNeedsCaptcha) {
                    discoveredNeedsCaptcha = true;
                    logger.info('CAPTCHA detected after interactions on probe page.');
                }
            }


            // C.3. XPath Discovery via LLM & Heuristics
            const snippets = this.htmlAnalyser.extractArticleSnippets(htmlForAnalysis);
            let llmFeedback = oldConfigHint && oldConfigHint.xpath_main_content ? [`Previous XPath ${oldConfigHint.xpath_main_content} failed.`] : [];
            let foundXPath = null;
            let bestCandidateDetails = null;

            for (let i = 0; i < this.configs.scraper.maxLlmRetries; i++) {
                logger.info(`LLM attempt ${i + 1}/${this.configs.scraper.maxLlmRetries} for ${url}`);
                const candidateXPaths = await this.llmInterface.getCandidateXPaths(htmlForAnalysis, snippets, llmFeedback);
                if (!candidateXPaths || candidateXPaths.length === 0) {
                    llmFeedback.push("LLM returned no candidate XPaths.");
                    logger.warn("LLM returned no candidates.");
                    continue;
                }

                const scoredCandidates = [];
                for (const xpath of candidateXPaths) {
                    // queryXPathWithDetails needs to work with raw HTML (if tentativeMethodIsCurl) or Puppeteer page
                    const details = tentativeMethodIsCurl ?
                        this.htmlAnalyser.queryStaticXPathWithDetails(htmlForAnalysis, xpath) :
                        await this.puppeteerController.queryXPathWithDetails(page, xpath);

                    if (!details || details.element_found_count === 0) {
                        llmFeedback.push(`XPath '${xpath}' found 0 elements.`);
                        continue;
                    }
                    const score = this.contentScoringEngine.scoreElement(details);
                    if (score > this.configs.scraper.minXpathScoreThreshold) { // Add a min score threshold
                        scoredCandidates.push({ xpath, score, details });
                    } else {
                        llmFeedback.push(`XPath '${xpath}' scored low (${score}). Paragraphs: ${details.paragraphCount || 0}.`);
                    }
                }

                if (scoredCandidates.length > 0) {
                    scoredCandidates.sort((a, b) => b.score - a.score); // Sort descending by score
                    foundXPath = scoredCandidates[0].xpath;
                    bestCandidateDetails = scoredCandidates[0].details;
                    logger.info(`Found promising XPath: ${foundXPath} with score: ${scoredCandidates[0].score}`);
                    break;
                }
                llmFeedback = llmFeedback.slice(-5); // Keep feedback concise
            }

            // C.4. Outcome of Discovery
            if (foundXPath && bestCandidateDetails) {
                let methodToStore;
                if (tentativeMethodIsCurl) {
                    // Quickly re-validate if this XPath works on cURL HTML
                    const curlValidation = this.htmlAnalyser.extractByXpath(curlHtml, foundXPath);
                    if (curlValidation) {
                        methodToStore = METHODS.CURL;
                    } else {
                        // Fallback to puppeteer if curl validation fails, assuming JS was needed after all
                        methodToStore = discoveredNeedsCaptcha ? METHODS.PUPPETEER_CAPTCHA : METHODS.PUPPETEER_STEALTH;
                        logger.warn(`XPath ${foundXPath} found via cURL analysis but failed re-validation on cURL HTML. Switching to Puppeteer method.`);
                    }
                } else {
                    methodToStore = discoveredNeedsCaptcha ? METHODS.PUPPETEER_CAPTCHA : METHODS.PUPPETEER_STEALTH;
                }

                const newConfig = {
                    domain_pattern: domain,
                    method: methodToStore,
                    xpath_main_content: foundXPath,
                    last_successful_scrape_timestamp: new Date().toISOString(),
                    failure_count_since_last_success: 0,
                    site_specific_headers: null,
                    user_agent_to_use: userAgent, // Store the UA that led to success
                    needs_captcha_solver: discoveredNeedsCaptcha,
                    puppeteer_wait_conditions: null, // Could try to learn this too
                    discovered_by_llm: true,
                };
                await this.knownSitesManager.saveConfig(domain, newConfig);
                logger.info(`New config saved for ${domain}. Method: ${methodToStore}, XPath: ${foundXPath}`);

                // Now, extract content using the newly discovered config
                if (requestedOutput === 'full_html') {
                    // If method is cURL, use curlHtml. If Puppeteer, use puppeteerHtml or re-fetch if necessary.
                    const finalHtml = (methodToStore === METHODS.CURL && curlHtml) ? curlHtml : puppeteerHtml || htmlForAnalysis;
                    return { success: true, data: finalHtml, method: methodToStore, xpath: foundXPath };
                }

                // If method is Puppeteer and CAPTCHA was involved, ensure it's solved
                if (methodToStore === METHODS.PUPPETEER_CAPTCHA && discoveredNeedsCaptcha) {
                    if (!page) { // If page was closed (e.g. cURL path initially taken)
                         ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, userAgent));
                    }
                    const captchaSolved = await this.captchaSolver.solveIfPresent(page, url);
                    if (!captchaSolved) throw new Error('CAPTCHA solving failed during final extraction.');
                    await page.waitForTimeout(this.configs.scraper.puppeteerPostLoadDelay);
                }

                let extractedElementHtml;
                if (methodToStore === METHODS.CURL) {
                    extractedElementHtml = this.htmlAnalyser.extractByXpath(curlHtml, foundXPath);
                } else { // Puppeteer methods
                    if (!page) { // Ensure page context if not already available
                        ({ browser, page } = await this.puppeteerController.launchAndNavigate(url, proxyDetails, userAgent));
                        // If CAPTCHA was needed and solved, it should happen before this point or be re-triggered
                    }
                    const elements = await page.$x(foundXPath);
                    if (elements.length > 0) {
                       extractedElementHtml = await page.evaluate(el => el.innerHTML, elements[0]);
                       await elements[0].dispose();
                    }
                }

                if (extractedElementHtml) {
                    return { success: true, data: extractedElementHtml, method: methodToStore, xpath: foundXPath };
                } else {
                    throw new Error(`Newly discovered XPath ${foundXPath} failed to extract content.`);
                }

            } else {
                logger.error(`XPath discovery failed for ${url} after all retries.`);
                if (this.configs.scraper.saveHtmlOnFailure) {
                    // Implement saving HTML to failed_html_dumps
                    // e.g., fs.writeFileSync(path.join(this.configs.scraper.failedHtmlDumpsPath, `${domain}_${Date.now()}.html`), htmlForAnalysis);
                }
                throw new Error('XPath discovery failed.');
            }

        } catch (error) {
            // Log the error with appropriate detail based on type
            if (error instanceof ScraperError) {
                logger.error(`${error.name} during discovery/scrape for ${url}: ${error.message}`, error.details);
            } else {
                logger.error(`Error during discovery/scrape for ${url}: ${error.message} ${error.stack}`);
            }

            // Create a structured error response with appropriate details
            const errorResponse = {
                success: false,
                data: null,
                error: error.message
            };

            // Add more specific error details based on error type
            if (error instanceof NetworkError) {
                errorResponse.errorType = 'network';
                errorResponse.errorDetails = error.details;
            } else if (error instanceof CaptchaError) {
                errorResponse.errorType = 'captcha';
                errorResponse.errorDetails = error.details;
            } else if (error instanceof ExtractionError) {
                errorResponse.errorType = 'extraction';
                errorResponse.errorDetails = error.details;
            } else if (error instanceof LLMError) {
                errorResponse.errorType = 'llm';
                errorResponse.errorDetails = error.details;
            } else if (error instanceof ConfigurationError) {
                errorResponse.errorType = 'configuration';
                errorResponse.errorDetails = error.details;
            }

            return errorResponse;
        } finally {
            if (browser) {
                await this.puppeteerController.cleanupPuppeteer(browser);
            }
        }
    }
}

export { CoreScraperEngine };
