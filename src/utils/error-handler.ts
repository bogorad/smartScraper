// src/utils/error-handler.ts

interface ErrorDetails {
  originalError?: Error | unknown;
  originalErrorName?: string;
  originalErrorMessage?: string;
  statusCode?: number;
  url?: string;
  xpath?: string;
  method?: string;
  reason?: string;
  htmlContent?: string; // Consider removing or truncating this for production
  [key: string]: any; // Allow other details
}

/**
 * Base custom error class for the scraper application.
 * Represents operational errors that the scraper is designed to handle.
 */
export class ScraperError extends Error {
  public details?: ErrorDetails;
  public timestamp: string;

  constructor(message: string, details?: ErrorDetails) {
    super(message);
    this.name = this.constructor.name; // Set the error name to the class name
    this.details = details;          // Any additional details about the error
    this.timestamp = new Date().toISOString();

    // Attempt to append original stack if useful, or just keep its message
    if (details?.originalError instanceof Error && details.originalError.stack) {
      // this.stack = `${this.stack}\nCaused by: ${details.originalError.stack}`;
    } else if (details?.originalErrorMessage) {
      // this.message = `${this.message} (Original: ${details.originalErrorMessage})`;
    }
    
    // This line is needed to make `instanceof ScraperError` work correctly
    // when transpiling to older JavaScript versions.
    Object.setPrototypeOf(this, new.target.prototype);

    // Capturing the stack trace, excluding the constructor call from it.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = (new Error(message)).stack;
    }
  }
}

/**
 * Error specific to LLM interactions.
 */
export class LLMError extends ScraperError {}

/**
 * Error specific to CAPTCHA solving processes.
 */
export class CaptchaError extends ScraperError {}

/**
 * Error specific to network operations (cURL, Puppeteer navigation).
 */
export class NetworkError extends ScraperError {}

/**
 * Error specific to configuration issues.
 */
export class ConfigurationError extends ScraperError {}

/**
 * Error when content extraction fails (e.g., XPath not found, content empty).
 */
export class ExtractionError extends ScraperError {}
