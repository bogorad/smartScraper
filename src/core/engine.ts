import PQueue from "p-queue";
import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import { parseHTML } from "linkedom";
import type {
  BrowserPort,
  LlmPort,
  CaptchaPort,
  KnownSitesPort,
  SimpleFetchPort,
} from "../ports/index.js";
import type {
  ScrapeOptions,
  ScrapeResult,
  ScrapeContext,
  ElementDetails,
} from "../domain/models.js";
import {
  METHODS,
  OUTPUT_TYPES,
  ERROR_TYPES,
  CAPTCHA_TYPES,
  SCORING,
  DEFAULTS,
  PROXY_MODES,
  type MethodValue,
} from "../constants.js";
import { extractDomain, isValidUrl } from "../utils/url.js";
import {
  simplifyDom,
  extractSnippets,
} from "../utils/dom.js";
import { utcNow } from "../utils/date.js";
import {
  cleanHtml,
  extractText,
  toMarkdown,
} from "../utils/html-cleaner.js";
import { extractEmbeddedArticleFromHtml } from "./embedded-article.js";
import { scoreElement } from "./scoring.js";
import { recordScrapeOutcome } from "../services/scrape-events.js";
import { logger } from "../utils/logger.js";
import { buildSessionProxyUrl } from "../utils/proxy.js";
import {
  getDatadomeProxyHost,
  getDatadomeProxyLogin,
  getDatadomeProxyPassword,
  getConcurrency,
  getExtensionPaths,
  getProxyServer,
} from "../config.js";

export const workerEvents = new EventEmitter();

export class CoreScraperEngine {
  private static readonly MAX_QUEUE_SIZE = 100;
  private queue: PQueue;
  private activeScrapes = new Map<string, string>(); // scrapeId -> url
  private readonly maxWorkers: number;

  constructor(
    private browserPort: BrowserPort,
    private llmPort: LlmPort,
    private captchaPort: CaptchaPort,
    private knownSitesPort: KnownSitesPort,
    private simpleFetchPort?: SimpleFetchPort,
  ) {
    this.maxWorkers = getConcurrency();
    this.queue = new PQueue({
      concurrency: this.maxWorkers,
    });
    logger.info(
      `[ENGINE] Initialized with concurrency: ${this.maxWorkers}`,
    );
  }

  getQueueSize(): number {
    return this.queue.size;
  }

  getActiveWorkers(): number {
    return this.activeScrapes.size;
  }

  getMaxWorkers(): number {
    return this.maxWorkers;
  }

  getActiveUrls(): string[] {
    return Array.from(this.activeScrapes.values());
  }

  /**
   * Build a success result with appropriate output format.
   * Centralizes result construction to avoid duplication.
   */
  private async buildSuccessResult(
    pageId: string | null,
    xpath: string,
    rawContent: string,
    outputType: string,
    cleanerOptions?: { siteCleanupClasses?: string[] },
    method: MethodValue = METHODS.PUPPETEER_STEALTH,
    fullHtml?: string,
  ): Promise<ScrapeResult> {
    let data: string | object;

    if (outputType === OUTPUT_TYPES.FULL_HTML) {
      data =
        fullHtml ??
        (pageId
          ? await this.browserPort.getPageHtml(pageId)
          : rawContent);
    } else if (outputType === OUTPUT_TYPES.METADATA_ONLY) {
      data = { xpath, contentLength: rawContent.length };
    } else if (outputType === OUTPUT_TYPES.CLEANED_HTML) {
      data = cleanHtml(rawContent, cleanerOptions);
    } else if (outputType === OUTPUT_TYPES.MARKDOWN) {
      // For embedded JSON (plain text), just return as-is; for HTML, convert
      data = rawContent.includes("<")
        ? toMarkdown(rawContent, cleanerOptions)
        : rawContent;
    } else {
      // CONTENT_ONLY - extract text if HTML, else return as-is
      data = rawContent.includes("<")
        ? extractText(rawContent, cleanerOptions)
        : rawContent;
    }

    return {
      success: true,
      method,
      xpath,
      data,
    };
  }

  async scrapeUrl(
    url: string,
    options?: ScrapeOptions,
  ): Promise<ScrapeResult> {
    if (
      this.queue.size >= CoreScraperEngine.MAX_QUEUE_SIZE
    ) {
      logger.warn(
        "[ENGINE] Queue full, rejecting request",
        {
          queueSize: this.queue.size,
          url,
        },
      );
      return {
        success: false,
        errorType: ERROR_TYPES.CONFIGURATION,
        error: "Server overloaded, please retry later",
      };
    }

    return await this.queue.add(async () => {
      const scrapeId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const domain = extractDomain(url);

      this.activeScrapes.set(scrapeId, url);
      workerEvents.emit("change", {
        activeUrls: this.getActiveUrls(),
        active: this.getActiveWorkers(),
        max: this.getMaxWorkers(),
      });

      logger.scrapeStart(
        scrapeId,
        url,
        domain || "unknown",
        { outputType: options?.outputType },
      );

      const startTime = Date.now();
      try {
        const result = await this._executeScrape(
          scrapeId,
          url,
          options,
        );
        const duration = Date.now() - startTime;
        logger.scrapeEnd(
          scrapeId,
          url,
          domain || "unknown",
          result.success,
          duration,
          result.error,
        );
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMsg =
          error instanceof Error
            ? error.message
            : String(error);
        logger.scrapeEnd(
          scrapeId,
          url,
          domain || "unknown",
          false,
          duration,
          errorMsg,
        );
        throw error;
      } finally {
        this.activeScrapes.delete(scrapeId);
        workerEvents.emit("change", {
          activeUrls: this.getActiveUrls(),
          active: this.getActiveWorkers(),
          max: this.getMaxWorkers(),
        });
      }
    });
  }

  private async _executeScrape(
    scrapeId: string,
    url: string,
    options?: ScrapeOptions,
  ): Promise<ScrapeResult> {
    const startTime = Date.now();
    const domain = extractDomain(url);

    if (!isValidUrl(url) || !domain) {
      return {
        success: false,
        errorType: ERROR_TYPES.CONFIGURATION,
        error: "Invalid URL",
      };
    }

    const context: ScrapeContext = {
      targetUrl: url,
      normalizedDomain: domain,
      proxyDetails: options?.proxyDetails,
      userAgentString: options?.userAgentString,
      debugContextId: options?.debugContextId,
    };

    let result: ScrapeResult;
    let pageId: string | null = null;

    try {
      context.siteConfig =
        await this.knownSitesPort.getConfig(domain);
      logger.debug(
        `Site config lookup for ${domain}`,
        {
          found: !!context.siteConfig,
          needsProxy: context.siteConfig?.needsProxy,
        },
        "ENGINE",
      );
      const userAgentString =
        options?.userAgentString ??
        context.siteConfig?.userAgent;
      context.userAgentString = userAgentString;
      const headers = {
        ...context.siteConfig?.siteSpecificHeaders,
        ...options?.requestHeaders,
      };
      const pageLoadHeaders =
        Object.keys(headers).length > 0
          ? headers
          : undefined;

      // Check if site needs DataDome residential proxy
      let proxyUrl: string | undefined;
      if (
        context.siteConfig?.needsProxy ===
        PROXY_MODES.DATADOME
      ) {
        const host = getDatadomeProxyHost();
        const login = getDatadomeProxyLogin();
        const password = getDatadomeProxyPassword();

        if (!host || !login || !password) {
          logger.warn(
            "needsProxy=datadome but DATADOME_PROXY_* credentials not configured",
            { domain },
            "ENGINE",
          );
        } else {
          // Generate unique session URL for this scrape (2 min sticky IP)
          proxyUrl = buildSessionProxyUrl(
            host,
            login,
            password,
            DEFAULTS.PROXY_SESSION_MINUTES,
          );
          const sessionId =
            proxyUrl.match(/session-([^-]+)/)?.[1] ||
            "unknown";
          logger.proxySession(
            scrapeId,
            proxyUrl,
            sessionId,
            DEFAULTS.PROXY_SESSION_MINUTES,
          );
        }
      }

      const pageLoadProxy =
        proxyUrl ?? context.proxyDetails?.server;

      const simpleFetchResult =
        await this.trySimpleFetchScrape(
          context,
          options,
          startTime,
          userAgentString,
          pageLoadHeaders,
          pageLoadProxy,
        );

      if (simpleFetchResult) {
        return simpleFetchResult;
      }

      const { pageId: pid } =
        await this.browserPort.loadPage(url, {
          timeout:
            options?.timeoutMs || DEFAULTS.TIMEOUT_MS,
          proxy: pageLoadProxy,
          userAgentString,
          headers: pageLoadHeaders,
        });
      pageId = pid;

      const captchaDetection =
        await this.browserPort.detectCaptcha(pageId);
      logger.debug(
        "CAPTCHA detection result",
        {
          captchaType: captchaDetection.type,
          captchaUrl: captchaDetection.captchaUrl,
          scrapeId,
        },
        "ENGINE",
      );

      if (captchaDetection.type !== CAPTCHA_TYPES.NONE) {
        logger.captchaDetected(
          scrapeId,
          url,
          captchaDetection.type,
        );

        const captchaStart = Date.now();
        const solveResult =
          await this.captchaPort.solveIfPresent({
            pageId,
            pageUrl: url,
            captchaUrl: captchaDetection.captchaUrl,
            captchaTypeHint: captchaDetection.type,
            siteKey: captchaDetection.siteKey,
            proxyDetails: proxyUrl
              ? { server: proxyUrl }
              : context.proxyDetails,
            userAgentString: context.userAgentString,
          });
        const captchaDuration = Date.now() - captchaStart;

        logger.captchaSolved(
          scrapeId,
          url,
          solveResult.solved,
          captchaDuration,
          solveResult.reason,
        );

        if (!solveResult.solved) {
          result = {
            success: false,
            errorType: ERROR_TYPES.CAPTCHA,
            error:
              solveResult.reason || "CAPTCHA solve failed",
          };
          await this.recordResult(
            context,
            result,
            startTime,
          );
          return result;
        }

        // Handle Cloudflare Turnstile token injection
        if (
          captchaDetection.type ===
            CAPTCHA_TYPES.CLOUDFLARE &&
          solveResult.token
        ) {
          await this.browserPort.injectTurnstileToken(
            pageId,
            solveResult.token,
          );
          await this.browserPort.reload(
            pageId,
            options?.timeoutMs || DEFAULTS.TIMEOUT_MS,
          );
        } else if (solveResult.updatedCookie) {
          await this.browserPort.setCookies(
            pageId,
            solveResult.updatedCookie,
          );
          await this.browserPort.reload(
            pageId,
            options?.timeoutMs || DEFAULTS.TIMEOUT_MS,
          );
        }
      }

      let xpath: string | undefined =
        options?.xpathOverride;
      let needsDiscovery =
        !options?.disableDiscovery &&
        !xpath &&
        (!context.siteConfig?.xpathMainContent ||
          context.siteConfig.failureCountSinceLastSuccess >=
            DEFAULTS.MAX_REDISCOVERY_FAILURES);

      if (
        !xpath &&
        !needsDiscovery &&
        context.siteConfig?.xpathMainContent
      ) {
        xpath = context.siteConfig.xpathMainContent;
        const extracted =
          await this.browserPort.evaluateXPath(
            pageId,
            xpath,
          );

        if (
          !extracted ||
          extracted.length === 0 ||
          extracted[0].length < SCORING.MIN_CONTENT_CHARS
        ) {
          if (options?.disableDiscovery) {
            logger.debug(
              `[ENGINE] Validation failed for cached XPath ${xpath}, but discovery is disabled.`,
            );
          } else {
            needsDiscovery = true;
            xpath = undefined; // Reset xpath so discovery result is used
            logger.debug(
              `[ENGINE] Existing XPath ${context.siteConfig.xpathMainContent} failed validation (length: ${extracted?.[0]?.length || 0}). Needs discovery.`,
            );
            await this.knownSitesPort.incrementFailure(
              domain,
            );
          }
        } else {
          logger.debug(
            `[ENGINE] Using cached XPath: ${xpath}`,
          );
        }
      }

      if (needsDiscovery) {
        logger.debug("[ENGINE] Starting discovery phase");
        const html =
          await this.browserPort.getPageHtml(pageId);
        const simplifiedDom = simplifyDom(html);
        const snippets = extractSnippets(html);

        const suggestions =
          await this.llmPort.suggestXPaths({
            simplifiedDom,
            snippets,
            url,
          });

        logger.debug(
          `[ENGINE] LLM returned ${suggestions.length} suggestions`,
        );

        if (suggestions.length === 0) {
          result = {
            success: false,
            errorType: ERROR_TYPES.LLM,
            error: "No XPath suggestions",
          };
          await this.recordResult(
            context,
            result,
            startTime,
          );
          return result;
        }

        for (const suggestion of suggestions) {
          const details =
            await this.browserPort.getElementDetails(
              pageId,
              suggestion.xpath,
            );
          if (!details) continue;

          const score = scoreElement(details);
          logger.debug(
            `[ENGINE] Evaluating suggestion ${suggestion.xpath}: score=${score}, length=${details.textLength}`,
          );

          if (
            score >= SCORING.MIN_SCORE_THRESHOLD &&
            details.textLength >= SCORING.MIN_CONTENT_CHARS
          ) {
            xpath = suggestion.xpath;
            logger.debug(
              `[ENGINE] Accepted new XPath: ${xpath}`,
            );

            await this.knownSitesPort.saveConfig({
              domainPattern: domain,
              xpathMainContent: xpath,
              failureCountSinceLastSuccess: 0,
              lastSuccessfulScrapeTimestamp: utcNow(),
              discoveredByLlm: true,
            });
            break;
          }
        }

        if (!xpath) {
          // Fallback: Try extracting from embedded JSON (Apollo State, JSON-LD)
          logger.debug(
            "[ENGINE] XPath discovery failed, trying embedded JSON extraction",
          );
          const embeddedContent =
            extractEmbeddedArticleFromHtml(html);

          if (
            embeddedContent &&
            embeddedContent.length >=
              SCORING.MIN_CONTENT_CHARS
          ) {
            logger.info(
              `[ENGINE] Extracted ${embeddedContent.length} chars from embedded JSON`,
            );

            const outputType =
              options?.outputType ||
              OUTPUT_TYPES.CONTENT_ONLY;
            result = await this.buildSuccessResult(
              pageId,
              "embedded_json",
              embeddedContent,
              outputType,
            );

            await this.recordResult(
              context,
              result,
              startTime,
              embeddedContent.length,
            );
            return result;
          }

          // Save debug snapshot on discovery failure if debug enabled
          if (options?.debug) {
            const fullHtml =
              await this.browserPort.getPageHtml(pageId);
            const debugDir = path.join(
              process.cwd(),
              "data",
              "logs",
              "debug",
            );
            await fs.promises.mkdir(debugDir, {
              recursive: true,
            });
            const filename = `FAILED_${context.normalizedDomain.replace(/[^a-z0-9]/gi, "_")}_${Date.now()}.html`;
            await fs.promises.writeFile(
              path.join(debugDir, filename),
              fullHtml,
            );
            logger.debug(
              `[DEBUG] Saved FAILED HTML snapshot to ${filename}`,
            );
          }
          result = {
            success: false,
            errorType: ERROR_TYPES.EXTRACTION,
            error: "No valid XPath found",
          };
          await this.recordResult(
            context,
            result,
            startTime,
          );
          return result;
        }
      }

      const extracted =
        await this.browserPort.evaluateXPath(
          pageId,
          xpath!,
        );

      // Save debug snapshot if enabled via config (or options)
      // Note: We use logger.debug to decide if we should log to console, but writing file is separate
      // If user passed options.debug, we might want to force it, or stick to global config
      // For now, we'll align with the previous logic but use logger for the print output
      if (options?.debug) {
        const fullHtml =
          await this.browserPort.getPageHtml(pageId);
        const debugDir = path.join(
          process.cwd(),
          "data",
          "logs",
          "debug",
        );
        await fs.promises.mkdir(debugDir, {
          recursive: true,
        });
        const filename = `${context.normalizedDomain.replace(/[^a-z0-9]/gi, "_")}_${Date.now()}.html`;
        await fs.promises.writeFile(
          path.join(debugDir, filename),
          fullHtml,
        );
        logger.debug(
          `[DEBUG] Saved HTML snapshot to ${filename}`,
        );
        logger.debug(`[DEBUG] XPath used: ${xpath}`);
        logger.debug(
          `[DEBUG] Extracted count: ${extracted ? extracted.length : 0}`,
        );
      }

      if (!extracted || extracted.length === 0) {
        result = {
          success: false,
          errorType: ERROR_TYPES.EXTRACTION,
          error: "Extraction returned empty",
        };
        await this.knownSitesPort.incrementFailure(domain);
        await this.recordResult(context, result, startTime);
        return result;
      }

      await this.knownSitesPort.markSuccess(domain);

      const outputType =
        options?.outputType || OUTPUT_TYPES.CONTENT_ONLY;
      const rawHtml = extracted.join("\n");
      const cleanerOptions = {
        siteCleanupClasses:
          context.siteConfig?.siteCleanupClasses,
      };

      result = await this.buildSuccessResult(
        pageId,
        xpath!,
        rawHtml,
        outputType,
        cleanerOptions,
      );

      await this.recordResult(
        context,
        result,
        startTime,
        rawHtml.length,
      );
      return result;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown error";
      const stack =
        error instanceof Error ? error.stack : "";
      logger.error(
        `Scrape exception in engine`,
        { url, error: message, stack, scrapeId },
        "ENGINE",
      );
      result = {
        success: false,
        errorType: ERROR_TYPES.UNKNOWN,
        error: message,
      };
      await this.recordResult(context, result, startTime);
      return result;
    } finally {
      if (pageId) {
        try {
          await this.browserPort.closePage(pageId);
        } catch (e) {
          logger.debug(
            "[ENGINE] Page cleanup failed in finally block",
            { error: String(e), pageId },
          );
        }
      }
    }
  }

  private async recordResult(
    context: ScrapeContext,
    result: ScrapeResult,
    startTime: number,
    contentLength?: number,
  ): Promise<void> {
    await recordScrapeOutcome({
      context,
      result,
      startTime,
      contentLength,
    });
  }

  private async trySimpleFetchScrape(
    context: ScrapeContext,
    options: ScrapeOptions | undefined,
    startTime: number,
    userAgentString: string | undefined,
    headers: Record<string, string> | undefined,
    pageLoadProxy: string | undefined,
  ): Promise<ScrapeResult | null> {
    if (
      !this.isSimpleFetchEligible(
        context,
        options,
        headers,
        pageLoadProxy,
      )
    ) {
      return null;
    }

    try {
      const html = await this.simpleFetchPort!.fetchHtml(
        context.targetUrl,
        {
          timeoutMs:
            options?.timeoutMs || DEFAULTS.TIMEOUT_MS,
          userAgentString,
        },
      );

      let xpathSelector: string | undefined =
        options?.xpathOverride;
      let needsDiscovery =
        !options?.disableDiscovery &&
        !xpathSelector &&
        (!context.siteConfig?.xpathMainContent ||
          context.siteConfig.failureCountSinceLastSuccess >=
            DEFAULTS.MAX_REDISCOVERY_FAILURES);

      if (
        !xpathSelector &&
        !needsDiscovery &&
        context.siteConfig?.xpathMainContent
      ) {
        xpathSelector = context.siteConfig.xpathMainContent;
        const extracted = this.evaluateHtmlXPath(
          html,
          xpathSelector,
        );

        if (
          !extracted ||
          extracted.length === 0 ||
          extracted[0].length < SCORING.MIN_CONTENT_CHARS
        ) {
          if (options?.disableDiscovery) {
            return null;
          }

          needsDiscovery = true;
          xpathSelector = undefined;
        }
      }

      if (needsDiscovery) {
        const suggestions =
          await this.llmPort.suggestXPaths({
            simplifiedDom: simplifyDom(html),
            snippets: extractSnippets(html),
            url: context.targetUrl,
          });

        for (const suggestion of suggestions) {
          const details = this.getHtmlElementDetails(
            html,
            suggestion.xpath,
          );
          if (!details) continue;

          const score = scoreElement(details);
          if (
            score >= SCORING.MIN_SCORE_THRESHOLD &&
            details.textLength >= SCORING.MIN_CONTENT_CHARS
          ) {
            xpathSelector = suggestion.xpath;
            await this.knownSitesPort.saveConfig({
              domainPattern: context.normalizedDomain,
              xpathMainContent: xpathSelector,
              failureCountSinceLastSuccess: 0,
              lastSuccessfulScrapeTimestamp: utcNow(),
              discoveredByLlm: true,
            });
            break;
          }
        }

        if (!xpathSelector) {
          return null;
        }
      }

      const extracted = this.evaluateHtmlXPath(
        html,
        xpathSelector!,
      );
      if (!extracted || extracted.length === 0) {
        return null;
      }

      await this.knownSitesPort.markSuccess(
        context.normalizedDomain,
      );

      const outputType =
        options?.outputType || OUTPUT_TYPES.CONTENT_ONLY;
      const rawHtml = extracted.join("\n");
      const result = await this.buildSuccessResult(
        null,
        xpathSelector!,
        rawHtml,
        outputType,
        {
          siteCleanupClasses:
            context.siteConfig?.siteCleanupClasses,
        },
        'obscura_simple_fetch' as MethodValue,
        html,
      );

      await this.recordResult(
        context,
        result,
        startTime,
        rawHtml.length,
      );
      return result;
    } catch (error) {
      logger.debug(
        "Obscura simple fetch skipped after failure",
        { error: String(error), url: context.targetUrl },
        "ENGINE",
      );
      return null;
    }
  }

  private isSimpleFetchEligible(
    context: ScrapeContext,
    options: ScrapeOptions | undefined,
    headers: Record<string, string> | undefined,
    pageLoadProxy: string | undefined,
  ): boolean {
    return (
      !!this.simpleFetchPort &&
      getExtensionPaths().length === 0 &&
      !getProxyServer() &&
      !pageLoadProxy &&
      !options?.proxyDetails &&
      !headers &&
      !options?.debug &&
      !context.siteConfig?.needsFlaresolverr &&
      context.siteConfig?.needsProxy !==
        PROXY_MODES.DATADOME
    );
  }

  private evaluateHtmlXPath(
    html: string,
    xpathSelector: string,
  ): string[] | null {
    const nodes = this.selectHtmlNodes(html, xpathSelector);
    if (!nodes) {
      return null;
    }

    return nodes
      .map((node) => this.htmlNodeValue(node))
      .filter((value): value is string => !!value);
  }

  private getHtmlElementDetails(
    html: string,
    xpathSelector: string,
  ): ElementDetails | null {
    const nodes = this.selectHtmlNodes(html, xpathSelector);
    const element = nodes?.find(
      (node) => node.nodeType === 1,
    ) as Element | undefined;
    if (!element) {
      return null;
    }

    const text = element.textContent || "";
    const links = Array.from(element.querySelectorAll("a"));
    const linkText = links
      .map((link) => link.textContent || "")
      .join("");

    return {
      xpath: xpathSelector,
      textLength: text.length,
      linkDensity:
        text.length > 0 ? linkText.length / text.length : 0,
      paragraphCount: element.querySelectorAll("p").length,
      headingCount: element.querySelectorAll(
        "h1,h2,h3,h4,h5,h6",
      ).length,
      hasMedia:
        element.querySelectorAll("img,video,audio").length >
        0,
      domDepth: this.getDomDepth(element),
      semanticScore: [
        "article",
        "main",
        "section",
      ].includes(element.tagName.toLowerCase())
        ? 1
        : 0,
      unwantedTagScore: [
        "nav",
        "aside",
        "footer",
        "header",
      ].includes(element.tagName.toLowerCase())
        ? 1
        : 0,
    };
  }

  private selectHtmlNodes(
    html: string,
    xpathSelector: string,
  ): Element[] | null {
    const cssSelector = this.xpathToCss(xpathSelector);
    if (!cssSelector) {
      return null;
    }

    try {
      const { document } = parseHTML(html);
      return Array.from(
        document.querySelectorAll(cssSelector),
      );
    } catch {
      return null;
    }
  }

  private xpathToCss(xpathSelector: string): string | null {
    const trimmed = xpathSelector.trim();
    if (
      !trimmed.startsWith("//") ||
      trimmed.includes("|")
    ) {
      return null;
    }

    const parts = trimmed
      .slice(2)
      .split(/\/+/)
      .map((part) => this.xpathStepToCss(part))
      .filter((part): part is string => !!part);

    return parts.length > 0 ? parts.join(" ") : null;
  }

  private xpathStepToCss(step: string): string | null {
    const tagMatch = step.match(/^(\*|[a-zA-Z][\w-]*)/);
    if (!tagMatch) {
      return null;
    }

    const tag = tagMatch[1] === "*" ? "" : tagMatch[1];
    const idMatch = step.match(/\[@id=(["'])([^"']+)\1\]/);
    if (idMatch) {
      return `${tag}#${this.cssEscape(idMatch[2])}`;
    }

    const classMatch = step.match(
      /\[@class=(["'])([^"']+)\1\]/,
    );
    if (classMatch) {
      return `${tag}[class~="${classMatch[2].replaceAll('"', '\\"')}"]`;
    }

    const containsClassMatch = step.match(
      /contains\(\s*@class\s*,\s*(["'])([^"']+)\1\s*\)/,
    );
    if (containsClassMatch) {
      return `${tag}[class*="${containsClassMatch[2].replaceAll('"', '\\"')}"]`;
    }

    return tag || "*";
  }

  private cssEscape(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  private htmlNodeValue(node: Node): string | null {
    if (node.nodeType === 1) {
      return (node as Element).outerHTML;
    }

    if (node.nodeType === 2 || node.nodeType === 3) {
      return node.nodeValue;
    }

    return null;
  }

  private getDomDepth(element: Element): number {
    let depth = 0;
    let current: Element | null = element;
    while (current) {
      depth++;
      current = current.parentElement;
    }
    return depth;
  }
}

let defaultEngine: CoreScraperEngine | null = null;

export function getDefaultEngine(): CoreScraperEngine {
  if (!defaultEngine) {
    throw new Error(
      "Engine not initialized. Call initializeEngine() first.",
    );
  }
  return defaultEngine;
}

export function initializeEngine(
  browserPort: BrowserPort,
  llmPort: LlmPort,
  captchaPort: CaptchaPort,
  knownSitesPort: KnownSitesPort,
  simpleFetchPort?: SimpleFetchPort,
): CoreScraperEngine {
  defaultEngine = new CoreScraperEngine(
    browserPort,
    llmPort,
    captchaPort,
    knownSitesPort,
    simpleFetchPort,
  );
  return defaultEngine;
}

export async function scrapeUrl(
  url: string,
  options?: ScrapeOptions,
): Promise<ScrapeResult> {
  return getDefaultEngine().scrapeUrl(url, options);
}

export function getQueueStats(): {
  size: number;
  active: number;
  max: number;
  activeUrls: string[];
} {
  const engine = getDefaultEngine();
  return {
    size: engine.getQueueSize(),
    active: engine.getActiveWorkers(),
    max: engine.getMaxWorkers(),
    activeUrls: engine.getActiveUrls(),
  };
}
