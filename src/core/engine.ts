import PQueue from 'p-queue';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import type { BrowserPort, LlmPort, CaptchaPort, KnownSitesPort } from '../ports/index.js';
import type { ScrapeOptions, ScrapeResult, ScrapeContext, LogEntry } from '../domain/models.js';
import { METHODS, OUTPUT_TYPES, ERROR_TYPES, CAPTCHA_TYPES, SCORING, DEFAULTS, PROXY_MODES } from '../constants.js';
import { extractDomain, isValidUrl } from '../utils/url.js';
import { simplifyDom, extractSnippets } from '../utils/dom.js';
import { utcNow } from '../utils/date.js';
import { cleanHtml, extractText, toMarkdown } from '../utils/html-cleaner.js';
import { scoreElement } from './scoring.js';
import { recordScrape } from '../services/stats-storage.js';
import { logScrape } from '../services/log-storage.js';
import { logger } from '../utils/logger.js';
import { buildSessionProxyUrl } from '../utils/proxy.js';
import { getDatadomeProxyHost, getDatadomeProxyLogin, getDatadomeProxyPassword } from '../config.js';

export const workerEvents = new EventEmitter();

export class CoreScraperEngine {
  private queue = new PQueue({ concurrency: 5 });
  private activeScrapes = new Map<string, string>(); // scrapeId -> url

  constructor(
    private browserPort: BrowserPort,
    private llmPort: LlmPort,
    private captchaPort: CaptchaPort,
    private knownSitesPort: KnownSitesPort
  ) {}

  getQueueSize(): number {
    return this.queue.size;
  }

  getActiveWorkers(): number {
    return this.queue.pending;
  }

  getMaxWorkers(): number {
    return 5;
  }

  getActiveUrls(): string[] {
    return Array.from(this.activeScrapes.values());
  }

  async scrapeUrl(url: string, options?: ScrapeOptions): Promise<ScrapeResult> {
    return await this.queue.add(async () => {
      const scrapeId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const domain = extractDomain(url);
      
      this.activeScrapes.set(scrapeId, url);
      workerEvents.emit('change', { activeUrls: this.getActiveUrls(), active: this.getActiveWorkers(), max: this.getMaxWorkers() });
      
      logger.scrapeStart(scrapeId, url, domain || 'unknown', { outputType: options?.outputType });
      
      const startTime = Date.now();
      try {
        const result = await this._executeScrape(scrapeId, url, options);
        const duration = Date.now() - startTime;
        logger.scrapeEnd(scrapeId, url, domain || 'unknown', result.success, duration, result.error);
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.scrapeEnd(scrapeId, url, domain || 'unknown', false, duration, errorMsg);
        throw error;
      } finally {
        this.activeScrapes.delete(scrapeId);
        workerEvents.emit('change', { activeUrls: this.getActiveUrls(), active: this.getActiveWorkers(), max: this.getMaxWorkers() });
      }
    });
  }

  private async _executeScrape(scrapeId: string, url: string, options?: ScrapeOptions): Promise<ScrapeResult> {
    const startTime = Date.now();
    const domain = extractDomain(url);

    if (!isValidUrl(url) || !domain) {
      return { success: false, errorType: ERROR_TYPES.CONFIGURATION, error: 'Invalid URL' };
    }

    const context: ScrapeContext = {
      targetUrl: url,
      normalizedDomain: domain,
      proxyDetails: options?.proxyDetails,
      userAgentString: options?.userAgentString,
      debugContextId: options?.debugContextId
    };

    let result: ScrapeResult;
    let pageId: string | null = null;

    try {
      context.siteConfig = await this.knownSitesPort.getConfig(domain);
      logger.debug(`Site config lookup for ${domain}`, { found: !!context.siteConfig, needsProxy: context.siteConfig?.needsProxy }, 'ENGINE');

      // Check if site needs DataDome residential proxy
      let proxyUrl: string | undefined;
      if (context.siteConfig?.needsProxy === PROXY_MODES.DATADOME) {
        const host = getDatadomeProxyHost();
        const login = getDatadomeProxyLogin();
        const password = getDatadomeProxyPassword();
        
        if (!host || !login || !password) {
          logger.warn('needsProxy=datadome but DATADOME_PROXY_* credentials not configured', { domain }, 'ENGINE');
        } else {
          // Generate unique session URL for this scrape (2 min sticky IP)
          proxyUrl = buildSessionProxyUrl(host, login, password, DEFAULTS.PROXY_SESSION_MINUTES);
          const sessionId = proxyUrl.match(/session-([^-]+)/)?.[1] || 'unknown';
          logger.proxySession(scrapeId, proxyUrl, sessionId, DEFAULTS.PROXY_SESSION_MINUTES);
        }
      }

      const { pageId: pid } = await this.browserPort.loadPage(url, {
        timeout: options?.timeoutMs || DEFAULTS.TIMEOUT_MS,
        proxy: proxyUrl
      });
      pageId = pid;

      const captchaDetection = await this.browserPort.detectCaptcha(pageId);
      logger.debug('CAPTCHA detection result', { 
        captchaType: captchaDetection.type, 
        captchaUrl: captchaDetection.captchaUrl,
        scrapeId 
      }, 'ENGINE');

      if (captchaDetection.type !== CAPTCHA_TYPES.NONE) {
        logger.captchaDetected(scrapeId, url, captchaDetection.type);
        
        const captchaStart = Date.now();
        const solveResult = await this.captchaPort.solveIfPresent({
          pageId,
          pageUrl: url,
          captchaUrl: captchaDetection.captchaUrl,
          captchaTypeHint: captchaDetection.type,
          proxyDetails: proxyUrl ? { server: proxyUrl } : context.proxyDetails,
          userAgentString: context.userAgentString
        });
        const captchaDuration = Date.now() - captchaStart;

        logger.captchaSolved(scrapeId, url, solveResult.solved, captchaDuration, solveResult.reason);

        if (!solveResult.solved) {
          result = {
            success: false,
            errorType: ERROR_TYPES.CAPTCHA,
            error: solveResult.reason || 'CAPTCHA solve failed'
          };
          await this.recordResult(context, result, startTime);
          return result;
        }

        if (solveResult.updatedCookie) {
          await this.browserPort.setCookies(pageId, solveResult.updatedCookie);
          await this.browserPort.reload(pageId, options?.timeoutMs || DEFAULTS.TIMEOUT_MS);
        }
      }

      let xpath: string | undefined = options?.xpathOverride;
      let needsDiscovery = !options?.disableDiscovery && !xpath && (!context.siteConfig?.xpathMainContent ||
        (context.siteConfig.failureCountSinceLastSuccess >= DEFAULTS.MAX_REDISCOVERY_FAILURES));

      if (!xpath && !needsDiscovery && context.siteConfig?.xpathMainContent) {
        xpath = context.siteConfig.xpathMainContent;
        const extracted = await this.browserPort.evaluateXPath(pageId, xpath);
        
        if (!extracted || extracted.length === 0 || extracted[0].length < SCORING.MIN_CONTENT_CHARS) {
          if (options?.disableDiscovery) {
            logger.debug(`[ENGINE] Validation failed for cached XPath ${xpath}, but discovery is disabled.`);
          } else {
            needsDiscovery = true;
            logger.debug(`[ENGINE] Existing XPath ${xpath} failed validation (length: ${extracted?.[0]?.length || 0}). Needs discovery.`);
            await this.knownSitesPort.incrementFailure(domain);
          }
        } else {
          logger.debug(`[ENGINE] Using cached XPath: ${xpath}`);
        }
      }

      if (needsDiscovery) {
        logger.debug('[ENGINE] Starting discovery phase');
        const html = await this.browserPort.getPageHtml(pageId);
        const simplifiedDom = simplifyDom(html);
        const snippets = extractSnippets(html);

        const suggestions = await this.llmPort.suggestXPaths({
          simplifiedDom,
          snippets,
          url
        });
        
        logger.debug(`[ENGINE] LLM returned ${suggestions.length} suggestions`);

        if (suggestions.length === 0) {
          result = { success: false, errorType: ERROR_TYPES.LLM, error: 'No XPath suggestions' };
          await this.recordResult(context, result, startTime);
          return result;
        }

        for (const suggestion of suggestions) {
          const details = await this.browserPort.getElementDetails(pageId, suggestion.xpath);
          if (!details) continue;

          const score = scoreElement(details);
          logger.debug(`[ENGINE] Evaluating suggestion ${suggestion.xpath}: score=${score}, length=${details.textLength}`);
          
          if (score >= SCORING.MIN_SCORE_THRESHOLD && details.textLength >= SCORING.MIN_CONTENT_CHARS) {
            xpath = suggestion.xpath;
            logger.debug(`[ENGINE] Accepted new XPath: ${xpath}`);

            await this.knownSitesPort.saveConfig({
              domainPattern: domain,
              xpathMainContent: xpath,
              failureCountSinceLastSuccess: 0,
              lastSuccessfulScrapeTimestamp: utcNow(),
              discoveredByLlm: true
            });
            break;
          }
        }

        if (!xpath) {
          result = { success: false, errorType: ERROR_TYPES.EXTRACTION, error: 'No valid XPath found' };
          await this.recordResult(context, result, startTime);
          return result;
        }
      }

      const extracted = await this.browserPort.evaluateXPath(pageId, xpath!);
      
      // Save debug snapshot if enabled via config (or options)
      // Note: We use logger.debug to decide if we should log to console, but writing file is separate
      // If user passed options.debug, we might want to force it, or stick to global config
      // For now, we'll align with the previous logic but use logger for the print output
      if (options?.debug) {
          const fullHtml = await this.browserPort.getPageHtml(pageId);
          const debugDir = path.join(process.cwd(), 'data', 'logs', 'debug');
          await fs.promises.mkdir(debugDir, { recursive: true });
          const filename = `${context.normalizedDomain.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.html`;
          await fs.promises.writeFile(path.join(debugDir, filename), fullHtml);
          logger.debug(`[DEBUG] Saved HTML snapshot to ${filename}`);
          logger.debug(`[DEBUG] XPath used: ${xpath}`);
          logger.debug(`[DEBUG] Extracted count: ${extracted ? extracted.length : 0}`);
      }

      if (!extracted || extracted.length === 0) {
        result = { success: false, errorType: ERROR_TYPES.EXTRACTION, error: 'Extraction returned empty' };
        await this.knownSitesPort.incrementFailure(domain);
        await this.recordResult(context, result, startTime);
        return result;
      }

      await this.knownSitesPort.markSuccess(domain);

      const outputType = options?.outputType || OUTPUT_TYPES.CONTENT_ONLY;
      let data: string | object;

      const rawHtml = extracted.join('\n');
      const cleanerOptions = {
        siteCleanupClasses: context.siteConfig?.siteCleanupClasses
      };

      if (outputType === OUTPUT_TYPES.FULL_HTML) {
        data = await this.browserPort.getPageHtml(pageId);
      } else if (outputType === OUTPUT_TYPES.METADATA_ONLY) {
        data = { xpath, contentLength: rawHtml.length };
      } else if (outputType === OUTPUT_TYPES.CLEANED_HTML) {
        data = cleanHtml(rawHtml, cleanerOptions);
      } else if (outputType === OUTPUT_TYPES.MARKDOWN) {
        data = toMarkdown(rawHtml, cleanerOptions);
      } else {
        data = extractText(rawHtml, cleanerOptions);
      }

      result = {
        success: true,
        method: METHODS.PUPPETEER_STEALTH,
        xpath,
        data
      };

      await this.recordResult(context, result, startTime);
      return result;

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : '';
      logger.error(`Scrape exception in engine`, { url, error: message, stack, scrapeId }, 'ENGINE');
      result = { success: false, errorType: ERROR_TYPES.UNKNOWN, error: message };
      await this.recordResult(context, result, startTime);
      return result;

    } finally {
      if (pageId) {
        try {
          await this.browserPort.closePage(pageId);
        } catch {}
      }
    }
  }

  private async recordResult(
    context: ScrapeContext,
    result: ScrapeResult,
    startTime: number
  ): Promise<void> {
    const ms = Date.now() - startTime;

    await recordScrape(context.normalizedDomain, result.success);

    const entry: LogEntry = {
      ts: utcNow(),
      domain: context.normalizedDomain,
      url: context.targetUrl,
      success: result.success,
      method: result.method,
      xpath: result.xpath,
      errorType: result.errorType,
      error: result.error,
      ms
    };

    await logScrape(entry);
  }
}

let defaultEngine: CoreScraperEngine | null = null;

export function getDefaultEngine(): CoreScraperEngine {
  if (!defaultEngine) {
    throw new Error('Engine not initialized. Call initializeEngine() first.');
  }
  return defaultEngine;
}

export function initializeEngine(
  browserPort: BrowserPort,
  llmPort: LlmPort,
  captchaPort: CaptchaPort,
  knownSitesPort: KnownSitesPort
): CoreScraperEngine {
  defaultEngine = new CoreScraperEngine(browserPort, llmPort, captchaPort, knownSitesPort);
  return defaultEngine;
}

export async function scrapeUrl(url: string, options?: ScrapeOptions): Promise<ScrapeResult> {
  return getDefaultEngine().scrapeUrl(url, options);
}

export function getQueueStats(): { size: number; active: number; max: number; activeUrls: string[] } {
  const engine = getDefaultEngine();
  return {
    size: engine.getQueueSize(),
    active: engine.getActiveWorkers(),
    max: engine.getMaxWorkers(),
    activeUrls: engine.getActiveUrls()
  };
}
