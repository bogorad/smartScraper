// src/utils/error-handler.js

/**
 * Base custom error class for the scraper application.
 */
class ScraperError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = this.constructor.name; // Set the error name to the class name
        this.details = details;          // Any additional details about the error
        this.timestamp = new Date().toISOString();

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
class LLMError extends ScraperError {
    constructor(message, llmDetails = {}, originalError = null) {
        super(message, { llm: llmDetails, originalError: originalError ? originalError.message : null });
        this.name = 'LLMError';
    }
}

/**
 * Error specific to CAPTCHA solving processes.
 */
class CaptchaError extends ScraperError {
    constructor(message, captchaDetails = {}, originalError = null) {
        super(message, { captcha: captchaDetails, originalError: originalError ? originalError.message : null });
        this.name = 'CaptchaError';
    }
}

/**
 * Error specific to network operations (cURL, Puppeteer navigation).
 */
class NetworkError extends ScraperError {
    constructor(message, networkDetails = {}, originalError = null) {
        super(message, { network: networkDetails, originalError: originalError ? originalError.message : null });
        this.name = 'NetworkError';
    }
}

/**
 * Error specific to configuration issues.
 */
class ConfigurationError extends ScraperError {
    constructor(message, configDetails = {}) {
        super(message, { configuration: configDetails });
        this.name = 'ConfigurationError';
    }
}

/**
 * Error when content extraction fails (e.g., XPath not found, content empty).
 */
class ExtractionError extends ScraperError {
    constructor(message, extractionDetails = {}) {
        super(message, { extraction: extractionDetails });
        this.name = 'ExtractionError';
    }
}


// You can add more specific error types as needed.

export {
    ScraperError,
    LLMError,
    CaptchaError,
    NetworkError,
    ConfigurationError,
    ExtractionError,
};

// Example usage:
// import { LLMError, NetworkError } from './error-handler.js';
//
// function someLLMFunction() {
//   // ...
//   if (errorCondition) {
//     throw new LLMError('LLM failed to respond', { promptLength: 1000 }, originalApiError);
//   }
// }
//
// try {
//   someLLMFunction();
// } catch (e) {
//   if (e instanceof LLMError) {
//     logger.error(`LLM Specific Error: ${e.message}`, e.details);
//   } else if (e instanceof ScraperError) {
//     logger.error(`General Scraper Error: ${e.message}`, e.details);
//   } else {
//     logger.error(`Unknown error: ${e.message}`);
//   }
// }
