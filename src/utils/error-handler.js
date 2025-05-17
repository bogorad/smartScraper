// src/utils/error-handler.js

/**
 * Base custom error class for the scraper application.
 * Represents operational errors that the scraper is designed to handle.
 */
class ScraperError extends Error {
  constructor(message, details = {}, originalError = null) {
    super(message);
    this.name = this.constructor.name; // Set the error name to the class name
    this.details = details;          // Any additional details about the error
    this.timestamp = new Date().toISOString();
    if (originalError && originalError.stack) {
        // Attempt to append original stack if useful, or just keep its message
        this.originalStack = originalError.stack;
        if (!this.details.originalError) this.details.originalError = originalError.message;
    }

    // This line is needed to make `instanceof ScraperError` work correctly
    // when transpiling to older JavaScript versions.
    if (typeof Object.setPrototypeOf === 'function') {
        Object.setPrototypeOf(this, new.target.prototype);
    } else {
        this.__proto__ = new.target.prototype;
    }

    // Capturing the stack trace, excluding the constructor call from it.
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = (new Error(message)).stack;
    }
  }
}

/**
 * Error specific to LLM interactions.
 */
class LLMError extends ScraperError {}

/**
 * Error specific to CAPTCHA solving processes.
 */
class CaptchaError extends ScraperError {}

/**
 * Error specific to network operations (cURL, Puppeteer navigation).
 */
class NetworkError extends ScraperError {}

/**
 * Error specific to configuration issues.
 */
class ConfigurationError extends ScraperError {}

/**
 * Error when content extraction fails (e.g., XPath not found, content empty).
 */
class ExtractionError extends ScraperError {}


export {
  ScraperError,
  LLMError,
  CaptchaError,
  NetworkError,
  ConfigurationError,
  ExtractionError,
};
