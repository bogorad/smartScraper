# Universal Web Scraper: Detailed Specification (v5 - Revised)

## 1. Goal

To create a robust, **modular**, and adaptive web scraper capable of extracting relevant content from a wide variety of websites, including those with anti-scraping measures. The system should learn from successful scrapes to improve efficiency for known sites.

## 2. Core Principles

* **Modularity:** The system is designed as a collection of loosely coupled modules with well-defined responsibilities and interfaces, facilitating maintainability, testability, and extensibility.
* **Tiered Approach:** Prioritize simpler, faster methods (like cURL) and escalate to more complex, resource-intensive methods (like Puppeteer with LLM-assisted XPath discovery) only when necessary.
* **Learning & Adaptation:** Store successful scraping configurations (method, XPath, CAPTCHA needs) for known domains to expedite future requests. Re-discover configurations if they become stale.
* **Proxy Usage:** Supports HTTP proxies to bypass website restrictions and improve scraping success rates. Handles proxy authentication and configuration automatically.
* **Anti-Bot Evasion:** Puppeteer usage implies advanced stealth techniques by default, primarily through **`puppeteer-extra` and `puppeteer-extra-plugin-stealth`**. CAPTCHA solving is an additional layer.
* **Efficient LLM Usage:** (Planned) Extract only DOM structure with text size annotations instead of sending full HTML content to the LLM, reducing token usage while maintaining accuracy. (Currently sends full HTML for analysis).
* **Deterministic XPath Generation:** Set LLM temperature to zero for consistent and reliable XPath generation.

## 3. Obstacles Addressed

* User-Agent checks (assumes UA is provided or a reasonable default is used).
* Basic IP-based blocking (bypassed using HTTP proxies with authentication).
* Advanced bot detection (mitigated by `puppeteer-extra-plugin-stealth`).
* GDPR consent banners (via generic clickers, acknowledging limitations).
* CAPTCHAs (via integration with external solvers, with specific support for DataDome CAPTCHA detection and handling).
* Soft paywalls (basic attempts via plugins/interaction).
* Dynamic content loading triggered by user interaction (mouse movements, scrolling).
* Website structure changes breaking XPaths (via re-discovery).
* Identifying relevant content on unknown pages.
* Large HTML content exceeding LLM token limits (mitigation planned via DOM structure extraction).

## 4. Internal Data Structure: `KnownSitesTable`

This table (e.g., a JSON file or database), managed by the `KnownSitesTableManager` module, stores configurations for domains where scraping has been successful. Each entry could be keyed by a domain pattern.

**Fields per entry:**

* `domain_pattern`: The URL pattern this configuration applies to.
* `method`: The determined scraping method (`curl`, `puppeteer_stealth`, `puppeteer_captcha`).
* `xpath_main_content`: The validated XPath to the main relevant content.
* `last_successful_scrape_timestamp`: Timestamp of the last successful scrape using this config.
* `failure_count_since_last_success`: Counter for consecutive failures, to trigger re-validation/re-discovery.
* `site_specific_headers`: (Optional) Any custom HTTP headers required.
* `user_agent_to_use`: (Optional) A specific User-Agent string if one proved particularly effective (can be overridden by request-specific UA).
* `needs_captcha_solver`: (Boolean) True if a CAPTCHA was detected during discovery. If true, `method` will typically be `puppeteer_captcha`.
* `puppeteer_wait_conditions`: (Optional) Specific conditions for Puppeteer to wait for.
* `discovered_by_llm`: (Boolean) True if the XPath was found via the LLM discovery process.

## 5. High-Level Algorithm Flow (Orchestrated by a Core Scraper Engine)

1. **Request Initiation:** Core engine receives URL, proxy info, User-Agent (optional), etc.
2. **Known Site Check (via `KnownSitesTableManager`):**
   * If **Known Site & Config Valid:** Use stored configuration.
   * If **Known Site & Config Stale/Fails:** Trigger re-discovery.
   * If **Unknown Site:** Proceed to discovery.
3. **Unknown Site / Re-Discovery Process (Orchestrated by Discovery Sub-system):**
   * Utilize `CurlHandler` and `PuppeteerController` (with `puppeteer-extra-plugin-stealth`) to fetch page content.
   * `HtmlAnalyser` (now `HtmlAnalyserFixed`) checks for CAPTCHAs and JS dependency using `document.evaluate`.
   * (Planned: Extract DOM structure with text size annotations using `HtmlAnalyser.extractDomStructure()`).
   * Employ "SmartScraper" logic (combining `LLMInterface`, `ContentScoringEngine`, `HtmlAnalyser`) to identify XPath and confirm CAPTCHA needs.
   * If successful, `KnownSitesTableManager` stores new configuration.
4. **Content Extraction (Orchestrated by Extraction Sub-system):** Use determined method, XPath, and `CaptchaSolverIntegration` if needed.
5. **Return Data.**

## 6. Detailed Algorithm Steps

(Refer to `src/core/engine.js` for the most up-to-date logic. The general flow remains similar to the original README, with refinements in CAPTCHA handling and discovery.)

## 7. Modular Architecture & Key Sub-Modules

The system is designed with modularity in mind. Key modules include:

* **`CoreScraperEngine`**: Orchestrates the main workflow.
* **`KnownSitesTableManager`**: Manages `KnownSitesTable`.
* **`PuppeteerController`**: Manages Puppeteer instances, stealth, navigation.
* **`CurlHandler`**: Executes HTTP requests (currently via `axios`).
* **`DomComparator`**: Compares HTML DOM structures.
* **`LLMInterface`**: Interacts with the LLM API.
* **`ContentScoringEngine`**: Scores XPath candidates.
* **`CaptchaSolver` / `DataDomeSolver`**: Interfaces with CAPTCHA solving services.
* **`HtmlAnalyser` (effectively `HtmlAnalyserFixed`)**: Performs static HTML analysis, XPath evaluation using JSDOM and `document.evaluate`.
* **`PluginManager`**: Manages browser extensions loaded into Puppeteer, now configurable via `EXTENSION_PATHS`.

## 8. Common Content Patterns

(As previously listed in the original README - this section remains relevant for `ContentScoringEngine` and LLM prompting.)

## 9. Failure Handling & Re-validation

* Stale config detection (based on `failure_count_since_last_success` and `last_successful_scrape_timestamp`).
* Proactive re-validation.
* Debugging: If `DEBUG=true` in `.env`, HTML content for failed scrapes is saved to `./failed_html_dumps/`. If `SAVE_HTML_ON_SUCCESS_NAV=true` as well, HTML for successful scrapes is saved to `./success_html_dumps/`.
* LLM error handling.

## 10. Configuration

The system uses environment variables for configuration. Create a `.env` file in the root directory.

**Revised `.env` Example:**

\`\`\`dotenv
# --- LLM Configuration ---
# Your OpenRouter API Key
OPENROUTER_API_KEY=sk-or-v1-xxx
# The LLM model identifier to use
LLM_MODEL=google/gemini-2.0-flash-lite-001
# The temperature setting for the LLM (0 for deterministic output)
LLM_TEMPERATURE=0

# --- Puppeteer Configuration ---
# Path to your Chrome/Chromium executable (required if not in default path)
EXECUTABLE_PATH=/usr/lib/chromium/chromium
# Comma-separated list of absolute paths to browser extensions to load
EXTENSION_PATHS=/path/to/extension1/src,/path/to/extension2
# Whether to run Puppeteer in headless mode (true, false, or 'new')
# PUPPETEER_HEADLESS=true # This is typically configured in puppeteer-controller.js directly or via process.env.PUPPETEER_HEADLESS
# Timeout for Puppeteer operations in milliseconds
# PUPPETEER_TIMEOUT=30000 # This is typically configured in scraper-settings.js

# --- Proxy Configuration ---
# HTTP proxy for web scraping (format: http://username:password@hostname:port)
# This proxy is used for both curl and Puppeteer requests
HTTP_PROXY=http://xxx:xxx@proxy:port

# --- CAPTCHA Solver Configuration ---
# Your 2Captcha API key (or other supported service)
TWOCAPTCHA_API_KEY=your_2captcha_api_key_here
# CAPTCHA service name (default: 2captcha)
CAPTCHA_SERVICE_NAME=2captcha
# List of domains that need DataDome CAPTCHA handling (comma-separated)
# DATADOME_DOMAINS=wsj.com,nytimes.com # This is managed internally or could be a future enhancement

# --- Logging & Debugging Configuration ---
# Set to DEBUG, INFO, WARN, ERROR, or NONE
LOG_LEVEL=INFO
# Enable debug features like saving HTML dumps
DEBUG=false
# If DEBUG=true, save HTML of successfully scraped pages
SAVE_HTML_ON_SUCCESS_NAV=false
\`\`\`

**Key Changes Reflected in this README:**

*   Standardized on `TWOCAPTCHA_API_KEY`.
*   Added `EXTENSION_PATHS` for configuring browser extensions.
*   Replaced `SAVE_HTML_ON_FAILURE` with a general `DEBUG` flag. HTML saving for successes is controlled by `SAVE_HTML_ON_SUCCESS_NAV` (and `DEBUG`).
*   Updated module descriptions to reflect changes (e.g., `PluginManager`, `HtmlAnalyser` now uses `document.evaluate`).
*   (Planned/Future) Mention of `HtmlAnalyser.extractDomStructure()`.

## 11. Future Considerations / Advanced Features

(As previously listed: advanced interactions, ML for direct extraction, visual analysis, diverse content types, granular XPaths).
* Implement `HtmlAnalyser.extractDomStructure()` for LLM token optimization.
