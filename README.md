# Universal Web Scraper: Detailed Specification (v6 - Enhanced Processing)

## 1. Goal

To create a robust, **modular**, and adaptive web scraper capable of extracting relevant content from a wide variety of websites, including those with anti-scraping measures. The system should learn from successful scrapes to improve efficiency for known sites and leverage advanced HTML processing for more effective LLM interaction.

## 2. Core Principles

* **Modularity:** The system is designed as a collection of loosely coupled modules with well-defined responsibilities and interfaces, facilitating maintainability, testability, and extensibility.
* **Tiered Approach:** Prioritize simpler, faster methods (like cURL) and escalate to more complex, resource-intensive methods (like Puppeteer with LLM-assisted XPath discovery) only when necessary.
* **Learning & Adaptation:** Store successful scraping configurations (method, XPath, CAPTCHA needs) for known domains to expedite future requests. Re-discover configurations if they become stale.
* **Proxy Usage:** Supports HTTP proxies to bypass website restrictions and improve scraping success rates. Handles proxy authentication and configuration automatically.
* **Anti-Bot Evasion:** Puppeteer usage implies advanced stealth techniques by default, primarily through **`puppeteer-extra` and `puppeteer-extra-plugin-stealth`**. CAPTCHA solving is an additional layer.
* **Efficient LLM Usage:** Implemented **DOM structure extraction** (`HtmlAnalyserFixed.extractDomStructure()`). Instead of sending full HTML, a simplified DOM with truncated text and **text size annotations** (`data-original-text-length` attributes and summary comments) is sent to the LLM. This reduces token usage and helps the LLM focus on relevant page areas.
* **Deterministic XPath Generation:** Set LLM temperature to zero (or very low) for consistent and reliable XPath generation.
* **Advanced Content Scoring:** The `ContentScoringEngine` uses a sophisticated set of heuristics, including bonuses for specific content-related keywords in IDs/classes, penalties for shallow DOM hierarchy, and analysis of text/link density, to accurately identify the best content container from LLM suggestions.

## 3. Obstacles Addressed

* User-Agent checks.
* Basic IP-based blocking (via HTTP proxies).
* Advanced bot detection (via `puppeteer-extra-plugin-stealth`).
* GDPR consent banners (via generic clickers).
* CAPTCHAs (via external solvers, specific DataDome support).
* Soft paywalls (basic attempts via plugins/interaction).
* Dynamic content loading.
* Website structure changes (via re-discovery).
* Identifying relevant content on unknown pages (enhanced by new LLM input and scoring).
* Large HTML content exceeding LLM token limits (mitigated by DOM structure extraction).

## 4. Internal Data Structure: `KnownSitesTable`

(This structure remains largely the same as described previously. Managed by `KnownSitesTableManager`.)

**Fields per entry:**
* `domain_pattern`, `method`, `xpath_main_content`, `last_successful_scrape_timestamp`, `failure_count_since_last_success`, `site_specific_headers`, `user_agent_to_use`, `needs_captcha_solver`, `puppeteer_wait_conditions`, `discovered_by_llm`.

## 5. High-Level Algorithm Flow (Orchestrated by a Core Scraper Engine)

1.  **Request Initiation:** Core engine receives URL, proxy info, User-Agent, etc.
2.  **Known Site Check (via `KnownSitesTableManager`):**
    *   If **Known Site & Config Valid:** Use stored configuration.
    *   If **Known Site & Config Stale/Fails:** Trigger re-discovery.
    *   If **Unknown Site:** Proceed to discovery.
3.  **Unknown Site / Re-Discovery Process (Orchestrated by Discovery Sub-system):**
    *   Utilize `CurlHandler` and `PuppeteerController` to fetch page content.
    *   `HtmlAnalyserFixed` checks for CAPTCHAs.
    *   **`HtmlAnalyserFixed.extractDomStructure()` is called to create a simplified, annotated DOM.**
    *   This simplified DOM, along with text snippets, is sent to `LLMInterface`. The LLM prompt is tailored to understand these annotations.
    *   `ContentScoringEngine` (now enhanced) scores candidate XPaths from the LLM.
    *   If successful, `KnownSitesTableManager` stores new configuration.
4.  **Content Extraction (Orchestrated by Extraction Sub-system):** Use determined method, XPath, and `CaptchaSolverIntegration` if needed.
5.  **Return Data.**

## 6. Detailed Algorithm Steps

(Refer to `src/core/engine.js` for the most up-to-date logic. The general flow remains similar, but the discovery phase now includes DOM simplification for the LLM and uses enhanced scoring.)

## 7. Modular Architecture & Key Sub-Modules

* **`CoreScraperEngine`**: Orchestrates the main workflow.
* **`KnownSitesTableManager`**: Manages `KnownSitesTable`.
* **`PuppeteerController`**: Manages Puppeteer instances, stealth, navigation.
* **`CurlHandler`**: Executes HTTP requests.
* **`DomComparator`**: Compares HTML DOM structures.
* **`LLMInterface`**: Interacts with the LLM API, now using a prompt designed for annotated DOMs.
* **`ContentScoringEngine`**: Scores XPath candidates using enhanced heuristics.
* **`CaptchaSolver` / `DataDomeSolver`**: Interfaces with CAPTCHA solving services.
* **`HtmlAnalyserFixed`**: Performs static HTML analysis, XPath evaluation, and **DOM structure extraction with annotations**.
* **`PluginManager`**: Manages browser extensions.

## 8. Common Content Patterns

(The LLM prompt now explicitly includes a list of common class names, ID patterns, and attribute patterns to guide its search, based on `reference/test-find-xpath.js`.)

## 9. Failure Handling & Re-validation

(Remains similar to previous descriptions. Debug HTML dumps are still a key feature.)

## 10. Configuration

The system uses environment variables and `config/scraper-settings.js`.

**Key new/updated settings in `config/scraper-settings.js`:**
*   `domStructureMaxTextLength`: Max text to keep per node in simplified DOM.
*   `domStructureMinTextSizeToAnnotate`: Min original text length in an element to trigger annotation.
*   New `scoreWeights` for enhanced heuristics (e.g., `contentSpecificIdBonus`, `shallowHierarchyPenalty`).
*   `contentIdKeywordsRegex`, `contentClassKeywordsRegex` for specific keyword matching in scoring.

**Revised `.env.example` (showing relevant parts):**
```dotenv
# --- LLM Configuration ---
OPENROUTER_API_KEY=your_openrouter_api_key_here
LLM_MODEL=meta-llama/llama-3-8b-instruct:free
LLM_TEMPERATURE=0

# --- Puppeteer Configuration ---
PUPPETEER_EXECUTABLE_PATH=/usr/lib/chromium/chromium
# PUPPETEER_HEADLESS=true # Now in scraper-settings.js
# EXTENSION_PATHS="/path/to/extension1,/path/to/extension2" # Now in scraper-settings.js

# --- Proxy Configuration ---
HTTP_PROXY=http://xxx:xxx@proxy:port

# --- CAPTCHA Solver Configuration ---
TWOCAPTCHA_API_KEY=your_2captcha_api_key_here
# CAPTCHA_SERVICE_NAME=2captcha # Default in captcha-solver-config.js

# --- Logging & Debugging Configuration ---
LOG_LEVEL=INFO
DEBUG=false
SAVE_HTML_ON_SUCCESS_NAV=false

# --- DOM Structure Extraction (New - can be set in .env to override defaults) ---
# DOM_STRUCTURE_MAX_TEXT_LENGTH=15
# DOM_STRUCTURE_MIN_TEXT_SIZE_TO_ANNOTATE=100
```

**Key Changes Reflected in this README:**
*   Highlighting the new DOM structure extraction for LLM input.
*   Mentioning the enhanced `ContentScoringEngine`.
*   Updating configuration section for new settings.

## 11. Future Considerations / Advanced Features

(As previously listed: advanced interactions, ML for direct extraction, visual analysis, diverse content types, granular XPaths).
*   Further refine `extractDomStructure` for optimal balance of information and conciseness.
*   Tune new scoring weights in `ContentScoringEngine` based on broader testing.
