import type { ScrapeResult } from "../domain/models.js";
import {
  CAPTCHA_TYPES,
  ERROR_TYPES,
  type CaptchaTypeValue,
} from "../constants.js";

/**
 * Error sanitization utilities
 * Sanitizes internal errors for client consumption
 */

const CLIENT_SAFE_UNSUPPORTED_CAPTCHA_TYPES =
  new Set<CaptchaTypeValue>([
    CAPTCHA_TYPES.RECAPTCHA,
    CAPTCHA_TYPES.TURNSTILE,
    CAPTCHA_TYPES.HCAPTCHA,
    CAPTCHA_TYPES.UNSUPPORTED,
  ]);

function safeUnsupportedCaptchaMessage(
  message: string,
): string | null {
  const match = message.match(
    /^Unsupported CAPTCHA type: (recaptcha|turnstile|hcaptcha|unsupported)$/i,
  );

  if (!match) {
    return null;
  }

  const captchaType =
    match[1].toLowerCase() as CaptchaTypeValue;
  if (
    !CLIENT_SAFE_UNSUPPORTED_CAPTCHA_TYPES.has(captchaType)
  ) {
    return null;
  }

  return `Unsupported CAPTCHA type: ${captchaType}`;
}

/**
 * Sanitizes an error for client response
 * Returns a generic message to avoid information disclosure
 */
export function sanitizeErrorForClient(
  error: unknown,
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  const captchaMessage =
    safeUnsupportedCaptchaMessage(message);
  if (captchaMessage) {
    return captchaMessage;
  }

  // Map known safe error types to messages
  if (message.includes("Invalid URL")) {
    return "Invalid URL provided";
  }
  if (
    message.includes("timeout") ||
    message.includes("Timeout")
  ) {
    return "Request timed out";
  }
  if (message.includes("CAPTCHA")) {
    return "CAPTCHA challenge failed";
  }
  if (message.includes("rate limit")) {
    return "Rate limit exceeded";
  }

  // Default generic message for unknown errors
  return "An error occurred while processing the request";
}

export function sanitizeScrapeResultForClient(
  result: ScrapeResult,
): ScrapeResult {
  if (result.success) {
    return result;
  }

  const sanitized: ScrapeResult = {
    ...result,
    error: sanitizeErrorForClient(result.error),
  };

  if (result.errorType !== ERROR_TYPES.CAPTCHA) {
    delete sanitized.details;
    return sanitized;
  }

  const details =
    result.details &&
    typeof result.details === "object" &&
    "captchaType" in result.details
      ? result.details
      : undefined;
  const captchaType = details
    ? String(details.captchaType).toLowerCase()
    : undefined;

  if (
    captchaType &&
    CLIENT_SAFE_UNSUPPORTED_CAPTCHA_TYPES.has(
      captchaType as CaptchaTypeValue,
    )
  ) {
    sanitized.details = { captchaType };
  } else {
    delete sanitized.details;
  }

  return sanitized;
}

/**
 * Sanitizes error for logging (keeps full details)
 */
export function formatErrorForLogging(
  error: unknown,
): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack || ""}`;
  }
  return String(error);
}
