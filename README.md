# Universal Web Scraper: Detailed Specification (v7 - Robust Error Handling)

## 1. Goal
(Same as before)

## 2. Core Principles
(Same as before)
* **Robust Error Handling:** Clear distinction between operational errors (network issues, CAPTCHAs, content not found) and critical internal script errors (programming bugs). Operational errors are handled gracefully per URL, while critical script errors lead to immediate termination to prevent undefined behavior.

## 3. Obstacles Addressed
(Same as before)

## 4. Internal Data Structure: `KnownSitesTable`
(Same as before)

## 5. High-Level Algorithm Flow
(Same as before, refer to `smartScraper.dot` and `src/core/engine.js`)

## 6. Modular Architecture & Key Sub-Modules
(Same as before)

## 7. Configuration
(Same as before)

## 8. Debugging
To enable comprehensive debugging:
Set `export LOG_LEVEL=DEBUG`.
This activates:
*   Verbose `logger.debug()` statements.
*   Logging of full error objects for operational errors.
*   HTML dumps on failure (and optionally on success if `SAVE_HTML_ON_SUCCESS_NAV=true`).
*   More detailed output for critical internal script errors before termination.

## 9. Error Handling Philosophy
*   **Operational Errors (`ScraperError` and its subclasses):** These are expected issues during scraping (e.g., `NetworkError`, `CaptchaError`, `ExtractionError`). The `CoreScraperEngine` attempts to handle these (e.g., by triggering re-discovery). If unrecoverable for a specific URL, `scrapeUrl` returns a `{ success: false, ... }` object. The script in `tools/process_url_list.js` logs this failure and continues to the next URL.
*   **Critical Internal Script Errors (e.g., `TypeError`, `ReferenceError`):** These indicate bugs in the scraper's code. If such an error is caught at a high level (in `tools/process_url_list.js` or `src/index.js`), it is logged with high severity, and the script terminates immediately (`process.exit(1)`) to prevent further execution with potentially flawed logic.

## 10. Future Considerations
(Same as before)
