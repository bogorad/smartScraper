import PQueue from 'p-queue';
import fs from 'fs';
import path from 'path';
import type { BrowserPort, LlmPort, CaptchaPort, KnownSitesPort } from '../ports/index.js';
import type { ScrapeOptions, ScrapeResult, ScrapeContext, LogEntry } from '../domain/models.js';
import { METHODS, OUTPUT_TYPES, ERROR_TYPES, CAPTCHA_TYPES, SCORING, DEFAULTS } from '../constants.js';
import { extractDomain, isValidUrl } from '../utils/url.js';
import { simplifyDom, extractSnippets } from '../utils/dom.js';
import { utcNow } from '../utils/date.js';
import { cleanHtml, extractText, toMarkdown } from '../utils/html-cleaner.js';
import { scoreElement } from './scoring.js';
import { recordScrape } from '../services/stats-storage.js';
import { logScrape } from '../services/log-storage.js';

export class CoreScraperEngine {
  private queue = new PQueue({ concurrency: 1 });

  constructor(
    private browserPort: BrowserPort,
    private llmPort: LlmPort,
    private captchaPort: CaptchaPort,
    private knownSitesPort: KnownSitesPort
  ) {}

  async scrapeUrl(url: string, options?: ScrapeOptions): Promise<ScrapeResult> {
    return this.queue.add(() => this._executeScrape(url, options)) as Promise<ScrapeResult>;
  }

  private async _executeScrape(url: string, options?: ScrapeOptions): Promise<ScrapeResult> {
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

      const { pageId: pid } = await this.browserPort.loadPage(url, {
        timeout: options?.timeoutMs || DEFAULTS.TIMEOUT_MS
      });
      pageId = pid;

      const captchaType = await this.browserPort.detectCaptcha(pageId);
      if (captchaType !== CAPTCHA_TYPES.NONE) {
        const solveResult = await this.captchaPort.solveIfPresent({
          pageId,
          pageUrl: url,
          captchaTypeHint: captchaType,
          proxyDetails: context.proxyDetails,
          userAgentString: context.userAgentString
        });

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
          await this.browserPort.reload(pageId);
        }
      }

      let xpath: string | undefined = options?.xpathOverride;
      let needsDiscovery = !xpath && (!context.siteConfig?.xpathMainContent ||
        (context.siteConfig.failureCountSinceLastSuccess >= DEFAULTS.MAX_REDISCOVERY_FAILURES));

      if (!xpath && !needsDiscovery && context.siteConfig?.xpathMainContent) {
        xpath = context.siteConfig.xpathMainContent;
        const extracted = await this.browserPort.evaluateXPath(pageId, xpath);
        
        if (!extracted || extracted.length === 0 || extracted[0].length < SCORING.MIN_CONTENT_CHARS) {
          needsDiscovery = true;
          if (options?.debug) {
             console.log(`[DEBUG] Existing XPath ${xpath} failed validation. Needs discovery.`);
          }
          await this.knownSitesPort.incrementFailure(domain);
        }
      }

      if (needsDiscovery) {
        const html = await this.browserPort.getPageHtml(pageId);
        const simplifiedDom = simplifyDom(html);
        const snippets = extractSnippets(html);

        const suggestions = await this.llmPort.suggestXPaths({
          simplifiedDom,
          snippets,
          url
        });

        if (suggestions.length === 0) {
          result = { success: false, errorType: ERROR_TYPES.LLM, error: 'No XPath suggestions' };
          await this.recordResult(context, result, startTime);
          return result;
        }

        for (const suggestion of suggestions) {
          const details = await this.browserPort.getElementDetails(pageId, suggestion.xpath);
          if (!details) continue;

          const score = scoreElement(details);
          if (score >= SCORING.MIN_SCORE_THRESHOLD && details.textLength >= SCORING.MIN_CONTENT_CHARS) {
            xpath = suggestion.xpath;

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
      
      if (options?.debug) {
          const fullHtml = await this.browserPort.getPageHtml(pageId);
          const debugDir = path.join(process.cwd(), 'data', 'logs', 'debug');
          await fs.promises.mkdir(debugDir, { recursive: true });
          const filename = `${context.normalizedDomain.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.html`;
          await fs.promises.writeFile(path.join(debugDir, filename), fullHtml);
          console.log(`[DEBUG] Saved HTML snapshot to ${filename}`);
          console.log(`[DEBUG] XPath used: ${xpath}`);
          console.log(`[DEBUG] Extracted count: ${extracted ? extracted.length : 0}`);
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
      result = { success: false, errorType: ERROR_TYPES.UNKNOWN, error: message };
      await this.recordResult(context, result, startTime);
      return result;

    } finally {
      if (pageId) {
        try {
          await this.browserPort.close();
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
