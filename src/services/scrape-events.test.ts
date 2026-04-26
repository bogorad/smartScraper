import {
  beforeEach,
  describe,
  expect,
  afterEach,
  it,
  vi,
} from "vitest";
import { ERROR_TYPES, METHODS } from "../constants.js";
import type {
  ScrapeContext,
  ScrapeResult,
} from "../domain/models.js";
import { recordScrapeOutcome } from "./scrape-events.js";

const storage = vi.hoisted(() => ({
  logScrape: vi.fn().mockResolvedValue(undefined),
  recordScrape: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./stats-storage.js", () => ({
  recordScrape: storage.recordScrape,
}));

vi.mock("./log-storage.js", () => ({
  logScrape: storage.logScrape,
}));

vi.mock("../utils/date.js", () => ({
  utcNow: () => "2026-04-26T10:00:00.000Z",
}));

describe("recordScrapeOutcome", () => {
  const context: ScrapeContext = {
    targetUrl: "https://example.com/article",
    normalizedDomain: "example.com",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T10:00:01.250Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records aggregate stats and one activity log entry for success", async () => {
    const result: ScrapeResult = {
      success: true,
      method: METHODS.PUPPETEER_STEALTH,
      xpath: "//article",
      data: "Article text",
    };

    await recordScrapeOutcome({
      context,
      result,
      startTime: new Date(
        "2026-04-26T10:00:00.000Z",
      ).getTime(),
      contentLength: 250,
    });

    expect(storage.recordScrape).toHaveBeenCalledOnce();
    expect(storage.recordScrape).toHaveBeenCalledWith(
      "example.com",
      true,
    );
    expect(storage.logScrape).toHaveBeenCalledOnce();
    expect(storage.logScrape).toHaveBeenCalledWith({
      ts: "2026-04-26T10:00:00.000Z",
      domain: "example.com",
      url: "https://example.com/article",
      success: true,
      method: METHODS.PUPPETEER_STEALTH,
      xpath: "//article",
      contentLength: 250,
      errorType: undefined,
      error: undefined,
      ms: 1250,
    });
  });

  it("records failed outcomes without writing runtime logs", async () => {
    const result: ScrapeResult = {
      success: false,
      errorType: ERROR_TYPES.EXTRACTION,
      error: "Extraction returned empty",
    };

    await recordScrapeOutcome({
      context,
      result,
      startTime: new Date(
        "2026-04-26T10:00:00.750Z",
      ).getTime(),
    });

    expect(storage.recordScrape).toHaveBeenCalledWith(
      "example.com",
      false,
    );
    expect(storage.logScrape).toHaveBeenCalledWith({
      ts: "2026-04-26T10:00:00.000Z",
      domain: "example.com",
      url: "https://example.com/article",
      success: false,
      method: undefined,
      xpath: undefined,
      contentLength: undefined,
      errorType: ERROR_TYPES.EXTRACTION,
      error: "Extraction returned empty",
      ms: 500,
    });
  });
});
