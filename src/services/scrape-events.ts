import type {
  LogEntry,
  ScrapeContext,
  ScrapeResult,
} from "../domain/models.js";
import { utcNow } from "../utils/date.js";
import { logScrape } from "./log-storage.js";
import { recordScrape } from "./stats-storage.js";

interface CurlFallbackDetails {
  attemptedMethod?: LogEntry["attemptedMethod"];
  finalMethod?: LogEntry["finalMethod"];
  failure?: {
    reason?: string;
    message?: string;
  };
}

function getCurlFallbackDetails(
  details: unknown,
): CurlFallbackDetails | undefined {
  if (!details || typeof details !== "object") {
    return undefined;
  }

  const fallback = (details as { curlFallback?: unknown })
    .curlFallback;
  if (!fallback || typeof fallback !== "object") {
    return undefined;
  }

  return fallback as CurlFallbackDetails;
}

export interface ScrapeOutcomeInput {
  context: ScrapeContext;
  result: ScrapeResult;
  startTime: number;
  contentLength?: number;
}

/**
 * Records a finished scrape outcome.
 *
 * Responsibilities stay separate:
 * - stats-storage owns aggregate counters
 * - log-storage owns local activity JSONL entries
 * - logger owns structured runtime/debug logs outside this service
 */
export async function recordScrapeOutcome({
  context,
  result,
  startTime,
  contentLength,
}: ScrapeOutcomeInput): Promise<void> {
  const ms = Date.now() - startTime;
  const curlFallback = getCurlFallbackDetails(
    result.details,
  );

  await recordScrape(
    context.normalizedDomain,
    result.success,
  );

  const entry: LogEntry = {
    ts: utcNow(),
    domain: context.normalizedDomain,
    url: context.targetUrl,
    success: result.success,
    method: result.method,
    attemptedMethod:
      curlFallback?.attemptedMethod ?? context.methodAttempted,
    finalMethod:
      curlFallback?.finalMethod ?? result.method,
    curlFailureReason: curlFallback?.failure?.reason,
    chromeFailureReason:
      context.methodAttempted === "chrome" &&
      !result.success
        ? result.error
        : undefined,
    captchaStrategy:
      context.captchaStrategy ?? context.siteConfig?.captcha,
    proxyStrategy:
      context.proxyStrategy ?? context.siteConfig?.proxy,
    xpath: result.xpath,
    contentLength,
    errorType: result.errorType,
    error: result.error,
    ms,
  };

  await logScrape(entry);
}
