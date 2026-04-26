import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { CoreScraperEngine } from "./engine.js";
import type {
  BrowserPort,
  CaptchaPort,
  KnownSitesPort,
  LlmPort,
} from "../ports/index.js";
import {
  CAPTCHA_TYPES,
  ERROR_TYPES,
} from "../constants.js";

const scrapeEvents = vi.hoisted(() => ({
  recordScrapeOutcome: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../config.js", () => ({
  getConcurrency: () => 1,
  getDatadomeProxyHost: () => "",
  getDatadomeProxyLogin: () => "",
  getDatadomeProxyPassword: () => "",
  getLogLevel: () => "NONE",
  getProxyServer: () => "",
}));

vi.mock("../services/scrape-events.js", () => ({
  recordScrapeOutcome: scrapeEvents.recordScrapeOutcome,
}));

describe("CoreScraperEngine CAPTCHA error mapping", () => {
  let browser: BrowserPort;
  let llm: LlmPort;
  let captcha: CaptchaPort;
  let knownSites: KnownSitesPort;
  let engine: CoreScraperEngine;

  beforeEach(() => {
    vi.clearAllMocks();

    browser = {
      close: vi.fn().mockResolvedValue(undefined),
      closePage: vi.fn().mockResolvedValue(undefined),
      loadPage: vi
        .fn()
        .mockResolvedValue({ pageId: "page-123" }),
      evaluateXPath: vi.fn().mockResolvedValue([]),
      getPageHtml: vi
        .fn()
        .mockResolvedValue("<html></html>"),
      detectCaptcha: vi
        .fn()
        .mockResolvedValue({ type: CAPTCHA_TYPES.NONE }),
      getElementDetails: vi.fn().mockResolvedValue(null),
      getCookies: vi.fn().mockResolvedValue(""),
      setCookies: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn().mockResolvedValue(undefined),
    };

    llm = {
      suggestXPaths: vi.fn().mockResolvedValue([]),
    };

    captcha = {
      solveIfPresent: vi
        .fn()
        .mockResolvedValue({ solved: true }),
    };

    knownSites = {
      getConfig: vi.fn().mockResolvedValue(undefined),
      saveConfig: vi.fn().mockResolvedValue(undefined),
      incrementFailure: vi
        .fn()
        .mockResolvedValue(undefined),
      markSuccess: vi.fn().mockResolvedValue(undefined),
      deleteConfig: vi.fn().mockResolvedValue(undefined),
      getAllConfigs: vi.fn().mockResolvedValue([]),
    };

    engine = new CoreScraperEngine(
      browser,
      llm,
      captcha,
      knownSites,
    );
  });

  for (const [detectedType, clientType] of [
    [CAPTCHA_TYPES.RECAPTCHA, CAPTCHA_TYPES.RECAPTCHA],
    [CAPTCHA_TYPES.TURNSTILE, CAPTCHA_TYPES.TURNSTILE],
    [CAPTCHA_TYPES.HCAPTCHA, CAPTCHA_TYPES.HCAPTCHA],
    [CAPTCHA_TYPES.UNSUPPORTED, CAPTCHA_TYPES.UNSUPPORTED],
  ] as const) {
    it(`returns explicit ${clientType} unsupported CAPTCHA errors before XPath discovery`, async () => {
      browser.detectCaptcha = vi
        .fn()
        .mockResolvedValue({ type: detectedType });

      const result = await engine.scrapeUrl(
        "https://example.com/article",
      );

      expect(result).toEqual({
        success: false,
        errorType: ERROR_TYPES.CAPTCHA,
        error: `Unsupported CAPTCHA type: ${clientType}`,
        details: { captchaType: clientType },
      });
      expect(captcha.solveIfPresent).not.toHaveBeenCalled();
      expect(llm.suggestXPaths).not.toHaveBeenCalled();
      expect(browser.evaluateXPath).not.toHaveBeenCalled();
      expect(browser.closePage).toHaveBeenCalledWith(
        "page-123",
      );
    });
  }

  it("continues to send DataDome challenges to the CAPTCHA solver", async () => {
    browser.detectCaptcha = vi.fn().mockResolvedValue({
      type: CAPTCHA_TYPES.DATADOME,
      captchaUrl:
        "https://geo.captcha-delivery.com/captcha/",
    });

    await engine.scrapeUrl("https://example.com/article");

    expect(captcha.solveIfPresent).toHaveBeenCalledWith(
      expect.objectContaining({
        captchaTypeHint: CAPTCHA_TYPES.DATADOME,
      }),
    );
  });
});
