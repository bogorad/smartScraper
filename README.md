# Universal Web Scraper: Detailed Specification (v5)

## 1. Goal

To create a robust, **modular**, and adaptive web scraper capable of extracting relevant content from a wide variety of websites, including those with anti-scraping measures. The system should learn from successful scrapes to improve efficiency for known sites.

## 2. Core Principles

* **Modularity:** The system is designed as a collection of loosely coupled modules with well-defined responsibilities and interfaces, facilitating maintainability, testability, and extensibility.
* **Tiered Approach:** Prioritize simpler, faster methods (like cURL) and escalate to more complex, resource-intensive methods (like Puppeteer with LLM-assisted XPath discovery) only when necessary.
* **Learning & Adaptation:** Store successful scraping configurations (method, XPath, CAPTCHA needs) for known domains to expedite future requests. Re-discover configurations if they become stale.
* **Proxy Usage:** Supports HTTP proxies to bypass website restrictions and improve scraping success rates. Handles proxy authentication and configuration automatically.
* **Anti-Bot Evasion:** Puppeteer usage implies advanced stealth techniques by default, primarily through **`puppeteer-extra` and `puppeteer-extra-plugin-stealth`**. CAPTCHA solving is an additional layer.
* **Efficient LLM Usage:** Extract only DOM structure with text size annotations instead of sending full HTML content to the LLM, reducing token usage while maintaining accuracy.
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
* Large HTML content exceeding LLM token limits (via DOM structure extraction).

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
   * `HtmlAnalyser` checks for CAPTCHAs and JS dependency.
   * Extract DOM structure with text size annotations using `HtmlAnalyser.extractDomStructure()`.
   * Employ "SmartScraper" logic (combining `LLMInterface`, `ContentScoringEngine`, `HtmlAnalyser`) to identify XPath and confirm CAPTCHA needs.
   * If successful, `KnownSitesTableManager` stores new configuration.
4. **Content Extraction (Orchestrated by Extraction Sub-system):** Use determined method, XPath, and `CaptchaSolverIntegration` if needed.
5. **Return Data.**

## 6. Detailed Algorithm Steps

**A. Request Preparation (Handled by Core Scraper Engine)**

1. Receive input: `target_url`, `proxy_details`, `user_agent_string` (optional).
2. Delegate proxy and User-Agent configuration to `CurlHandler` and `PuppeteerController` for their respective operations.

**B. Known Site Processing (Core Scraper Engine interacting with `KnownSitesTableManager` and execution modules)**

1. Normalize `target_url`, query `KnownSitesTableManager`.
2. **If a matching entry is found:**
   a. Retrieve config: `method`, `xpath_main_content`, `needs_captcha_solver`, etc.
   b. If config stale/high failure, signal for re-discovery (proceed to **C**).
   c. **Execute Stored Method:**
      * If `method` is `curl`: Delegate to `CurlHandler`.
      * If `method` is `puppeteer_stealth`: Delegate to `PuppeteerController` (which uses `puppeteer-extra-plugin-stealth`).
      * If `method` is `puppeteer_captcha`: Delegate to `PuppeteerController` and `CaptchaSolverIntegration`.
   d. **Validate Extraction:** Check XPath.
   e. **If successful:** Update stats via `KnownSitesTableManager`, extract content, return data. **(END)**
   f. **If fails:** Increment failure count via `KnownSitesTableManager`, signal for re-discovery (proceed to **C**).

**C. Unknown Site Processing / XPath Re-Discovery (Discovery Sub-system)**

1. **C.1. Initial Probing:**
   a. `discovered_needs_captcha_solver = false`.
   b. **Attempt cURL (via `CurlHandler`):** Fetch page. If fails, note. `HtmlAnalyser` checks for CAPTCHA markers; if found, `discovered_needs_captcha_solver = true`.
   c. **Attempt Puppeteer (via `PuppeteerController` using `puppeteer-extra-plugin-stealth`):**
      * Launch, navigate, get `puppeteer_html`.
      * `HtmlAnalyser` checks `puppeteer_html` for CAPTCHA markers; if found, `discovered_needs_captcha_solver = true`.
   d. **Compare DOMs (via `DomComparator`, if cURL was successful):**
      * If cURL HTML and `puppeteer_html` are highly similar and cURL response is valid, `tentative_method_is_curl = true`, `html_for_analysis = curl_html`.
      * Else, `tentative_method_is_curl = false`, `html_for_analysis = puppeteer_html`.

2. **C.2. Page Preparation for XPath Discovery (if Puppeteer HTML is used, via `PuppeteerController`):**
   a. If `html_for_analysis` is from Puppeteer:
      * `PuppeteerController.navigateAndPreparePage()`: Full navigation, waits, interactions.
      * `html_for_analysis = await page.content()`.
      * `HtmlAnalyser` re-checks for CAPTCHA markers.

3. **C.3. DOM Structure Extraction and XPath Discovery via LLM & Heuristics:**
   a. `llm_feedback = []`.
   b. `article_snippets = HtmlAnalyser.extractArticleSnippets(html_for_analysis)`.
   c. **Extract DOM Structure:**
      * `dom_structure = HtmlAnalyser.extractDomStructure(html_for_analysis)` - This preserves tags and attributes but minimizes text content, adding annotations about original text sizes.
   d. **Loop** up to `MAX_LLM_RETRIES`:
      i. `llm_candidate_xpaths = LLMInterface.getLlmCandidateXPaths(dom_structure, article_snippets)`.
      ii. If LLM call fails/malformed, log, add feedback, `continue` or break.
      iii. `scored_candidates = []`.
      iv. For each `candidate_xpath`:
         1. `details = HtmlAnalyser.queryStaticXPathWithDetails(html_for_analysis, candidate_xpath)`.
         2. If element not found, add feedback, continue.
         3. `score = ContentScoringEngine.scoreElement(details, totalElementsFoundByXPath, candidate_xpath)`.
         4. If `score > 0`, add to `scored_candidates`.
         5. Else, add feedback.
      v. If `scored_candidates` not empty, `best_candidate =` highest scoring, `found_xpath = best_candidate.xpath`, break loop.
   e. `PuppeteerController.cleanupPuppeteer()` if instance was specific to discovery.

4. **C.4. Outcome of Discovery:**
   a. **If `found_xpath` is identified:**
      i. Determine `method_to_store`: `curl`, `puppeteer_stealth`, or `puppeteer_captcha` (based on `tentative_method_is_curl`, `found_xpath` validity on cURL HTML, and `discovered_needs_captcha_solver`).
      ii. `KnownSitesTableManager.updateEntry()`: Store new config.
      iii. Proceed to step **D (Content Extraction)**.
   b. **If no `found_xpath`:** Log failure, save debug HTML, return error. **(END)**

**D. Content Extraction (Extraction Sub-system)**

1. Method (`current_method`), XPath (`current_xpath`), CAPTCHA need (`current_needs_captcha`) are known.
2. **D.2. CAPTCHA Handling (if `current_method` is `puppeteer_captcha`, via `CaptchaSolverIntegration`):**
   a. Integrate with external CAPTCHA solving service.
   b. If solving fails, extraction attempt fails.
3. Execute `current_method` (via `CurlHandler` or `PuppeteerController`).
4. Once page loaded/rendered (and CAPTCHA solved): Extract content.
5. **Basic Validation:** Check XPath and content.

**E. Return Data (Handled by Core Scraper Engine)**

1. Return extracted content, status, messages.

## 7. Modular Architecture & Key Sub-Modules

The system is designed with modularity in mind to ensure separation of concerns, testability, and maintainability. A core "Scraper Engine" orchestrates the overall flow, delegating tasks to specialized modules:

* **`CoreScraperEngine`**: Orchestrates the main workflow, deciding whether to use known site logic or trigger discovery. Manages the overall state of a scraping request.
* **`KnownSitesTableManager`**:
  * **Responsibilities:** CRUD operations for the `KnownSitesTable`. Handles loading, querying by domain, saving/updating entries.
  * **Interface:** `getKnownSiteConfig(domain)`, `updateKnownSiteConfig(domain, config)`, `incrementFailureCount(domain)`.
* **`PuppeteerController`**:
  * **Responsibilities:** Manages all Puppeteer browser instances. Encapsulates Puppeteer setup, including the integration of **`puppeteer-extra` and `puppeteer-extra-plugin-stealth`** for enhanced anti-detection. Handles navigation, page interaction, XPath evaluation, and cleanup.
  * **Interface:** `launchBrowser(proxyConfig)`, `newPage(browserInstance)`, `navigateAndPreparePage(page, url, waitConditions)`, `getPageContent(page)`, `cleanupPuppeteer(browserInstance)`.
* **`CurlHandler`**:
  * **Responsibilities:** Executes HTTP requests using a cURL-like library. Handles headers, proxies, and timeouts for non-JavaScript reliant fetching.
  * **Interface:** `fetchPage(url, proxyConfig, headers, userAgent)`.
* **`DomComparator`**:
  * **Responsibilities:** Compares two HTML DOM structures (e.g., from cURL and Puppeteer) to assess similarity by converting to Markdown and calculating character-level similarity.
  * **Interface:** `compareDoms(htmlString1, htmlString2)`.
  * **Key Settings:** Uses a 60% similarity threshold to determine if DOMs are similar enough to use curl instead of Puppeteer.
* **`LLMInterface`**:
  * **Responsibilities:** Interacts with the Large Language Model API (e.g., OpenRouter). Constructs prompts, sends requests with temperature=0 for deterministic and consistent XPath generation, parses responses for candidate XPaths, and handles LLM API errors.
  * **Interface:** `getLlmCandidateXPaths(domStructure, snippets, feedbackContext)`.
  * **Key Settings:** Uses temperature=0 to ensure consistent XPath generation across multiple runs.
* **`ContentScoringEngine`**:
  * **Responsibilities:** Implements the heuristic scoring logic (`scoreElement`) to evaluate the relevance of content found by candidate XPaths.
  * **Interface:** `scoreElement(xpathDetails, totalElementsFoundByXPath, xpath)`.
* **`CaptchaSolverIntegration`**:
  * **Responsibilities:** Interfaces with external CAPTCHA solving services (e.g., 2Captcha, Anti-CAPTCHA). Manages API calls to submit CAPTCHAs and retrieve solutions.
  * **Interface:** `solveCaptcha(page, captchaType, siteKeyDetails)`.
* **`HtmlAnalyser`**:
  * **Responsibilities:** Performs static analysis on HTML content. Extracts text snippets for LLM context, detects CAPTCHA markers, extracts DOM structure with text size annotations, and evaluates XPath expressions using document.evaluate.
  * **Interface:** `extractArticleSnippets(htmlString)`, `detectCaptcha(htmlString)`, `extractDomStructure(htmlString, maxTextLength, minTextSizeToAnnotate)`, `queryStaticXPathWithDetails(htmlString, xpath)`, `extractByXpath(htmlString, xpath)`.
* **`PluginManager` (Optional but Recommended):**
  * **Responsibilities:** Manages the loading and execution of browser plugins/extensions within Puppeteer (e.g., adblockers, generic GDPR clickers).
  * **Interface:** `loadPlugins(puppeteerLaunchOptions)`, `triggerPluginActions(page)`.

## 8. Common Content Patterns

The system uses a comprehensive list of common content-related class/ID names to help identify article content across different websites:

1. **Common element types:**
   - `<article>` elements
   - `<main>` elements
   - `<div>` elements with descriptive classes/IDs
   - `<section>` elements with content-related attributes

2. **Common class names:**
   - "article__content"
   - "article-content"
   - "article-body"
   - "entry-content"
   - "body-content"
   - "post-body"
   - "story-body"
   - "content-body"
   - "main-content"
   - "article__text"
   - "article__body"
   - "story-text"
   - "article-text"
   - "article-dropcap"
   - "paywall-content"
   - "article__body"

3. **Common ID patterns:**
   - "article-content"
   - "article-body"
   - "content"
   - "main-content"
   - "article"
   - "story-content"
   - "post-content"

## 9. Failure Handling & Re-validation

(As previously listed: Stale config detection, proactive re-validation, debugging, LLM error handling – these would also be managed by relevant modules or the core engine).

## 10. Configuration

The system uses environment variables for configuration. Create a `.env` file in the root directory with the following variables:

```dotenv
# --- LLM Configuration ---
# Your OpenRouter API Key
OPENROUTER_API_KEY=your_openrouter_api_key_here
# The LLM model identifier to use (recommend a model with large context window)
LLM_MODEL=meta-llama/llama-4-maverick:free
# The temperature setting for the LLM (0 for deterministic output)
LLM_TEMPERATURE=0

# --- Puppeteer Configuration ---
# Path to your Chrome/Chromium executable (required)
EXECUTABLE_PATH=/usr/lib/chromium/chromium
# Whether to run Puppeteer in headless mode
PUPPETEER_HEADLESS=true
# Timeout for Puppeteer operations in milliseconds
PUPPETEER_TIMEOUT=30000
# HTTP proxy for web scraping (format: http://username:password@hostname:port)
# This proxy is used for both curl and Puppeteer requests
HTTP_PROXY=http://username:password@hostname:port

# --- CAPTCHA Solver Configuration ---
# Your 2Captcha API key
CAPTCHA_API_KEY=your_2captcha_api_key_here
# CAPTCHA service name (default: 2captcha)
CAPTCHA_SERVICE_NAME=2captcha
# List of domains that need DataDome CAPTCHA handling (comma-separated)
DATADOME_DOMAINS=wsj.com,nytimes.com

# --- Logging Configuration ---
# Set to DEBUG, INFO, WARN, ERROR, or NONE
LOG_LEVEL=INFO
```

## 11. Future Considerations / Advanced Features

(As previously listed: advanced interactions, ML for direct extraction, visual analysis, diverse content types, granular XPaths).

**Key Changes in this Version (v5):**

* Added DOM structure extraction with text size annotations to reduce LLM token usage while maintaining accuracy
* Updated XPath evaluation to use `document.evaluate` instead of `xpath.select` for better compatibility
* Added a comprehensive list of common content-related class/ID names
* Enhanced scoring function to better differentiate between container elements and actual content elements
* Added improved error handling and debugging for LLM responses
* Set LLM temperature to zero for deterministic XPath generation
* Added support for more content-specific classes including "article-dropcap" and "paywall-content"
* Added bonus for content-related IDs in scoring function
* Added HTTP proxy support for web scraping to bypass restrictions
* Enhanced DataDome CAPTCHA detection and handling for sites with anti-bot protection
* Updated module interfaces to reflect new functionality
* Improved DataDome CAPTCHA handling with proper cookie formatting
* Added automatic proxy usage for curl requests from HTTP_PROXY environment variable
* Enhanced DataDome CAPTCHA detection with additional markers
* Removed XPath expiration logic as it's no longer needed
* Added banned IP detection for DataDome CAPTCHA
* Lowered DOM similarity threshold from 90% to 60% for more realistic DOM comparison between curl and Puppeteer results
