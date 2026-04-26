import PQueue from "p-queue";
import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import type {
  BrowserPort,
  LlmPort,
  CaptchaPort,
  KnownSitesPort,
} from "../ports/index.js";
import type {
  CurlFetchFailure,
  CurlFetchPort,
} from "../ports/curl-fetch.js";
import type {
  ScrapeOptions,
  ScrapeResult,
  ScrapeContext,
  SiteConfig,
  SiteConfigCaptcha,
  SiteConfigProxy,
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
import { extractStaticArticleFromHtml } from "./static-html.js";
import { scoreElement } from "./scoring.js";
import { recordScrapeOutcome } from "../services/scrape-events.js";
import { logger } from "../utils/logger.js";
import { buildSessionProxyUrl } from "../utils/proxy.js";
import {
  getDatadomeProxyHost,
  getDatadomeProxyLogin,
  getDatadomeProxyPassword,
  getConcurrency,
  getProxyServer,
} from "../config.js";

export const workerEvents = new EventEmitter();

interface CurlFailureEvidence {
  reason: string;
  message: string;
  statusCode?: number;
  stderr?: string;
  exitCode?: number;
  htmlLength?: number;
}

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
    private curlFetchPort?: CurlFetchPort,
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
    method: MethodValue = METHODS.CHROME,
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
    let curlFailureEvidence:
      | CurlFailureEvidence
      | undefined;
    let discoveredXPath = false;
    let captchaStrategy: SiteConfigCaptcha = CAPTCHA_TYPES.NONE;
    let proxyStrategy: SiteConfigProxy = "none";
    context.captchaStrategy = captchaStrategy;
    context.proxyStrategy = proxyStrategy;

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

      const shouldTryCurl =
        !options?.xpathOverride &&
        this.curlFetchPort &&
        (!context.siteConfig ||
          context.siteConfig.method === METHODS.CURL);
      if (shouldTryCurl) {
        context.methodAttempted = METHODS.CURL;
        const curlResult = await this.tryCurlScrape(
          url,
          options,
          pageLoadHeaders,
          userAgentString,
          context.siteConfig?.xpathMainContent,
        );

        if (curlResult.result) {
          result = curlResult.result;
          await this.saveSuccessfulStrategyConfig(
            context,
            result.xpath ?? "embedded_json",
            METHODS.CURL,
            CAPTCHA_TYPES.NONE,
            "none",
            false,
          );
          await this.recordResult(
            context,
            result,
            startTime,
            curlResult.contentLength,
          );
          return result;
        }

        curlFailureEvidence = curlResult.failure;
        logger.warn(
          "[ENGINE] Curl scrape failed; falling back to chrome",
          {
            scrapeId,
            url,
            domain,
            curlFailure: curlFailureEvidence,
          },
          "ENGINE",
        );
      }

      const datadomeSolverProxyRequired =
        context.siteConfig?.captcha === CAPTCHA_TYPES.DATADOME ||
        context.siteConfig?.proxy === "datadome" ||
        context.siteConfig?.needsProxy ===
          PROXY_MODES.DATADOME;
      const datadomeSolverProxy = datadomeSolverProxyRequired
        ? this.buildDatadomeProxyUrl(
            scrapeId,
            domain,
            "site requires DataDome solver proxy",
          )
        : undefined;

      const defaultProxy = getProxyServer() || undefined;
      const pageLoadProxy =
        context.proxyDetails?.server ??
        (context.siteConfig?.proxy === "none"
          ? undefined
          : defaultProxy);
      const loadPageProxy =
        pageLoadProxy ?? (context.siteConfig?.proxy === "none"
          ? false
          : undefined);
      proxyStrategy = this.siteConfigProxyStrategy(
        pageLoadProxy,
      );
      context.proxyStrategy = proxyStrategy;
      logger.debug(
        "Resolved page and solver proxy strategies",
        {
          pageProxyStrategy: proxyStrategy,
          solverProxyStrategy: datadomeSolverProxy
            ? "datadome"
            : "none",
          siteProxy: context.siteConfig?.proxy,
          needsProxy: context.siteConfig?.needsProxy,
        },
        "ENGINE",
      );

      context.methodAttempted = METHODS.CHROME;
      const { pageId: pid } =
        await this.browserPort.loadPage(url, {
          timeout:
            options?.timeoutMs || DEFAULTS.TIMEOUT_MS,
          proxy: loadPageProxy,
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
        if (captchaDetection.type === CAPTCHA_TYPES.DATADOME) {
          captchaStrategy = CAPTCHA_TYPES.DATADOME;
          proxyStrategy = "datadome";
          context.captchaStrategy = captchaStrategy;
          context.proxyStrategy = proxyStrategy;
        }
        logger.captchaDetected(
          scrapeId,
          url,
          captchaDetection.type,
        );

        const unsupportedCaptchaType =
          this.unsupportedCaptchaType(
            captchaDetection.type,
          );
        if (unsupportedCaptchaType) {
          captchaStrategy =
            unsupportedCaptchaType as SiteConfigCaptcha;
          context.captchaStrategy = captchaStrategy;
          result = {
            success: false,
            errorType: ERROR_TYPES.CAPTCHA,
            error: `Unsupported CAPTCHA type: ${unsupportedCaptchaType}`,
            details: {
              captchaType: unsupportedCaptchaType,
            },
          };
          this.attachCurlFailureEvidence(
            result,
            curlFailureEvidence,
          );
          await this.recordResult(
            context,
            result,
            startTime,
          );
          return result;
        }

        const captchaStart = Date.now();
        const solveResult =
          await this.captchaPort.solveIfPresent({
            pageId,
            pageUrl: url,
            captchaUrl: captchaDetection.captchaUrl,
            captchaTypeHint: captchaDetection.type,
            siteKey: captchaDetection.siteKey,
            proxyDetails:
              captchaDetection.type ===
              CAPTCHA_TYPES.DATADOME
                ? this.getDatadomeCaptchaProxyDetails(
                    scrapeId,
                    domain,
                    datadomeSolverProxy,
                  )
                : pageLoadProxy
                  ? { server: pageLoadProxy }
                  : undefined,
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
          this.attachCurlFailureEvidence(
            result,
            curlFailureEvidence,
          );
          await this.recordResult(
            context,
            result,
            startTime,
          );
          return result;
        }

        if (solveResult.updatedCookie) {
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
            result = {
              success: false,
              errorType: ERROR_TYPES.EXTRACTION,
              error:
                "Cached XPath content did not meet minimum content length and discovery is disabled",
              details: {
                xpath,
                contentLength: extracted?.[0]?.length || 0,
                minContentLength: SCORING.MIN_CONTENT_CHARS,
              },
            };
            this.attachCurlFailureEvidence(
              result,
              curlFailureEvidence,
            );
            await this.knownSitesPort.incrementFailure(
              domain,
            );
            await this.recordResult(
              context,
              result,
              startTime,
            );
            return result;
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
            discoveredXPath = true;
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
            this.attachCurlFailureEvidence(
              result,
              curlFailureEvidence,
            );
            await this.saveSuccessfulStrategyConfig(
              context,
              "embedded_json",
              METHODS.CHROME,
              captchaStrategy,
              proxyStrategy,
              false,
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
          this.attachCurlFailureEvidence(
            result,
            curlFailureEvidence,
          );
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
        this.attachCurlFailureEvidence(
          result,
          curlFailureEvidence,
        );
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
      this.attachCurlFailureEvidence(
        result,
        curlFailureEvidence,
      );
      if (discoveredXPath) {
        await this.saveSuccessfulStrategyConfig(
          context,
          xpath!,
          METHODS.CHROME,
          captchaStrategy,
          proxyStrategy,
          true,
        );
      }

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
      this.attachCurlFailureEvidence(
        result,
        curlFailureEvidence,
      );
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

  private async saveSuccessfulStrategyConfig(
    context: ScrapeContext,
    xpath: string,
    method: MethodValue,
    captcha: SiteConfigCaptcha,
    proxy: SiteConfigProxy,
    discoveredByLlm: boolean,
  ): Promise<void> {
    const config: SiteConfig = {
      ...(context.siteConfig ?? {}),
      domainPattern:
        context.siteConfig?.domainPattern ??
        context.normalizedDomain,
      xpathMainContent: xpath,
      failureCountSinceLastSuccess: 0,
      lastSuccessfulScrapeTimestamp: utcNow(),
      discoveredByLlm,
      method,
      captcha,
      proxy,
      needsProxy:
        proxy === "datadome"
          ? PROXY_MODES.DATADOME
          : PROXY_MODES.OFF,
    };

    await this.knownSitesPort.saveConfig(config);
    context.siteConfig = config;
  }

  private siteConfigProxyStrategy(
    pageLoadProxy: string | undefined,
  ): SiteConfigProxy {
    return pageLoadProxy ? "default" : "none";
  }

  private async tryCurlScrape(
    url: string,
    options: ScrapeOptions | undefined,
    headers: Record<string, string> | undefined,
    userAgentString: string | undefined,
    preferredXPath?: string,
  ): Promise<{
    result?: ScrapeResult;
    failure?: CurlFailureEvidence;
    contentLength?: number;
  }> {
    if (!this.curlFetchPort) {
      return {
        failure: {
          reason: "not_configured",
          message: "Curl fetch port is not configured",
        },
      };
    }

    const curlResult = await this.curlFetchPort.fetchHtml(
      url,
      {
        timeoutMs:
          options?.timeoutMs || DEFAULTS.TIMEOUT_MS,
        headers,
        userAgentString,
        proxy: false,
      },
    );

    if (!curlResult.ok) {
      return {
        failure: this.buildCurlFailureEvidence(curlResult),
      };
    }

    const embeddedContent = extractEmbeddedArticleFromHtml(
      curlResult.html,
    );

    const staticContent =
      !embeddedContent ||
      embeddedContent.length < SCORING.MIN_CONTENT_CHARS
        ? extractStaticArticleFromHtml(
            curlResult.html,
            preferredXPath,
          )
        : null;
    const content = embeddedContent ?? staticContent?.html;
    const contentXPath = embeddedContent
      ? "embedded_json"
      : staticContent?.xpath;

    if (!content || !contentXPath) {
      return {
        failure: {
          reason: "unusable_content",
          message:
            "Curl response did not contain usable article content",
          statusCode: curlResult.statusCode,
          htmlLength: curlResult.html.length,
        },
      };
    }

    const outputType =
      options?.outputType || OUTPUT_TYPES.CONTENT_ONLY;
    const result = await this.buildSuccessResult(
      null,
      contentXPath,
      content,
      outputType,
      undefined,
      METHODS.CURL,
      curlResult.html,
    );

    logger.info(
      "[ENGINE] Curl scrape succeeded for unknown site",
      {
        url,
        statusCode: curlResult.statusCode,
        contentLength: content.length,
      },
      "ENGINE",
    );

    return {
      result,
      contentLength: content.length,
    };
  }

  private buildCurlFailureEvidence(
    failure: CurlFetchFailure,
  ): CurlFailureEvidence {
    return {
      reason: failure.reason,
      message: failure.message,
      statusCode: failure.statusCode,
      stderr: failure.stderr,
      exitCode: failure.exitCode,
    };
  }

  private attachCurlFailureEvidence(
    result: ScrapeResult,
    failure: CurlFailureEvidence | undefined,
  ): void {
    if (!failure) {
      return;
    }

    result.details = {
      ...(typeof result.details === "object" &&
      result.details !== null
        ? result.details
        : {}),
      curlFallback: {
        attemptedMethod: METHODS.CURL,
        finalMethod: result.method ?? METHODS.CHROME,
        failure,
      },
    };
  }

  private buildDatadomeProxyUrl(
    scrapeId: string,
    domain: string,
    reason: string,
  ): string | undefined {
    const host = getDatadomeProxyHost();
    const login = getDatadomeProxyLogin();
    const password = getDatadomeProxyPassword();

    if (!host || !login || !password) {
      logger.warn(
        "DataDome proxy required but DATADOME_PROXY_* credentials are not configured",
        { domain, reason },
        "ENGINE",
      );
      return undefined;
    }

    const proxyUrl = buildSessionProxyUrl(
      host,
      login,
      password,
      DEFAULTS.PROXY_SESSION_MINUTES,
    );
    const sessionId =
      proxyUrl.match(/session-([^-]+)/)?.[1] || "unknown";
    logger.proxySession(
      scrapeId,
      proxyUrl,
      sessionId,
      DEFAULTS.PROXY_SESSION_MINUTES,
    );
    return proxyUrl;
  }

  private getDatadomeCaptchaProxyDetails(
    scrapeId: string,
    domain: string,
    pageProxy: string | undefined,
  ): { server: string } | undefined {
    const proxy =
      pageProxy ??
      this.buildDatadomeProxyUrl(
        scrapeId,
        domain,
        "DataDome CAPTCHA detected",
      );

    return proxy ? { server: proxy } : undefined;
  }

  private unsupportedCaptchaType(
    captchaType: string,
  ): string | null {
    switch (captchaType) {
      case CAPTCHA_TYPES.RECAPTCHA:
        return CAPTCHA_TYPES.RECAPTCHA;
      case CAPTCHA_TYPES.TURNSTILE:
      case "cloudflare":
        return CAPTCHA_TYPES.TURNSTILE;
      case CAPTCHA_TYPES.HCAPTCHA:
        return CAPTCHA_TYPES.HCAPTCHA;
      case CAPTCHA_TYPES.UNSUPPORTED:
      case "generic":
        return CAPTCHA_TYPES.UNSUPPORTED;
      default:
        return null;
    }
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
  curlFetchPort?: CurlFetchPort,
): CoreScraperEngine {
  defaultEngine = new CoreScraperEngine(
    browserPort,
    llmPort,
    captchaPort,
    knownSitesPort,
    curlFetchPort,
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
