import type {
  LogEntry,
  ScrapeContext,
  ScrapeResult,
} from "../domain/models.js";
import { utcNow } from "../utils/date.js";
import { logScrape } from "./log-storage.js";
import { recordScrape } from "./stats-storage.js";

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
    xpath: result.xpath,
    contentLength,
    errorType: result.errorType,
    error: result.error,
    ms,
  };

  await logScrape(entry);
}
