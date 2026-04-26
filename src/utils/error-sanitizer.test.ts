import { describe, expect, it } from "vitest";
import {
  sanitizeErrorForClient,
  sanitizeScrapeResultForClient,
} from "./error-sanitizer.js";

describe("error sanitizer", () => {
  it("preserves explicit unsupported CAPTCHA types", () => {
    expect(
      sanitizeErrorForClient(
        "Unsupported CAPTCHA type: turnstile",
      ),
    ).toBe("Unsupported CAPTCHA type: turnstile");
  });

  it("does not expose arbitrary CAPTCHA error details", () => {
    expect(
      sanitizeErrorForClient(
        "CAPTCHA failed with token secret-token",
      ),
    ).toBe("CAPTCHA challenge failed");
  });

  it("keeps only safe unsupported CAPTCHA details in failed scrape results", () => {
    const result = sanitizeScrapeResultForClient({
      success: false,
      errorType: "CAPTCHA",
      error: "Unsupported CAPTCHA type: hcaptcha",
      details: {
        captchaType: "hcaptcha",
        apiKey: "secret-token",
      },
    });

    expect(result).toEqual({
      success: false,
      errorType: "CAPTCHA",
      error: "Unsupported CAPTCHA type: hcaptcha",
      details: { captchaType: "hcaptcha" },
    });
    expect(JSON.stringify(result)).not.toContain(
      "secret-token",
    );
  });
});
