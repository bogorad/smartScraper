You're right. If stealth is the baseline for any Puppeteer usage, then "basic Puppeteer" is redundant. The distinction should be between `puppeteer_stealth` (for JS rendering and standard interactions) and `puppeteer_captcha` (which implies stealth plus CAPTCHA solving capabilities).

This simplifies the logic slightly and makes the `method` field more precise.

Here's the revised specification reflecting this:

## Universal Web Scraper: Detailed Specification (Revised v3)

### 1. Goal

To create a robust and adaptive web scraper capable of extracting relevant content from a wide variety of websites, including those with anti-scraping measures. The system should learn from successful scrapes to improve efficiency for known sites.

### 2. Core Principles

*   **Tiered Approach:** Prioritize simpler, faster methods (like cURL) and escalate to more complex, resource-intensive methods (like Puppeteer with LLM-assisted XPath discovery) only when necessary.
*   **Learning & Adaptation:** Store successful scraping configurations (method, XPath, CAPTCHA needs) for known domains to expedite future requests. Re-discover configurations if they become stale.
*   **Proxy Usage (External):** Assumes proxy information is provided externally for requests.
*   **Anti-Bot Evasion:** Puppeteer usage implies stealth techniques by default. CAPTCHA solving is an additional layer.

### 3. Obstacles Addressed

*   User-Agent checks (assumes UA is provided or a reasonable default is used).
*   Basic IP-based blocking (relies on externally provided proxies).
*   GDPR consent banners (via generic clickers, acknowledging limitations).
*   CAPTCHAs (via integration with external solvers, for both new and known sites).
*   Soft paywalls (basic attempts via plugins/interaction).
*   Dynamic content loading triggered by user interaction (mouse movements, scrolling).
*   Website structure changes breaking XPaths (via re-discovery).
*   Identifying relevant content on unknown pages.

### 4. Internal Data Structure: `KnownSitesTable`

This table (e.g., a JSON file or database) stores configurations for domains where scraping has been successful. Each entry could be keyed by a domain pattern.

**Fields per entry:**

*   `domain_pattern`: The URL pattern this configuration applies to.
*   `method`: The determined scraping method (`curl`, `puppeteer_stealth`, `puppeteer_captcha`).
*   `xpath_main_content`: The validated XPath to the main relevant content.
*   `last_successful_scrape_timestamp`: Timestamp of the last successful scrape using this config.
*   `failure_count_since_last_success`: Counter for consecutive failures, to trigger re-validation/re-discovery.
*   `site_specific_headers`: (Optional) Any custom HTTP headers required.
*   `user_agent_to_use`: (Optional) A specific User-Agent string if one proved particularly effective (can be overridden by request-specific UA).
*   `needs_captcha_solver`: (Boolean) True if a CAPTCHA was detected during discovery. If true, `method` will typically be `puppeteer_captcha`.
*   `puppeteer_wait_conditions`: (Optional) Specific conditions for Puppeteer to wait for.
*   `discovered_by_llm`: (Boolean) True if the XPath was found via the LLM discovery process.

### 5. High-Level Algorithm Flow

1.  **Request Initiation:** Scraper receives URL, proxy info, User-Agent (optional), etc.
2.  **Known Site Check:**
    *   If **Known Site & Config Valid:** Use stored configuration (method will be `curl`, `puppeteer_stealth`, or `puppeteer_captcha`).
    *   If **Known Site & Config Stale/Fails:** Trigger re-discovery.
    *   If **Unknown Site:** Proceed to discovery.
3.  **Unknown Site / Re-Discovery Process:**
    *   Attempt cURL, then Puppeteer (with stealth) to fetch page content and analyze for JS dependency/CAPTCHAs.
    *   Employ "SmartScraper" logic (LLM + heuristics) to identify XPath and confirm CAPTCHA needs.
    *   If successful, store new configuration (`curl`, `puppeteer_stealth`, or `puppeteer_captcha`).
4.  **Content Extraction:** Use determined method, XPath, and CAPTCHA handling.
5.  **Return Data.**

### 6. Detailed Algorithm Steps

**A. Request Preparation**

1.  Receive input: `target_url`, `proxy_details`, `user_agent_string` (optional).
2.  Configure HTTP clients (cURL, Puppeteer) for proxy and User-Agent.

**B. Known Site Processing**

1.  Normalize `target_url`, check `KnownSitesTable`.
2.  **If a matching entry is found:**
    a.  Retrieve `method`, `xpath_main_content`, `needs_captcha_solver` (which informs if method is `puppeteer_captcha`), etc.
    b.  If config stale/high failure, proceed to **C (Re-Discovery)**.
    c.  **Execute Stored Method:**
        *   If `method` is `curl`: Use cURL.
        *   If `method` is `puppeteer_stealth`: Launch Puppeteer with stealth.
        *   If `method` is `puppeteer_captcha`: Launch Puppeteer with stealth AND integrate CAPTCHA solving logic (see **D.2**).
    d.  **Validate Extraction:** Check XPath.
    e.  **If successful:** Update stats, extract content, return data. **(END)**
    f.  **If fails:** Increment failure count, proceed to **C (Re-Discovery)**.

**C. Unknown Site Processing / XPath Re-Discovery (SmartScraper Logic Integration)**

1.  **C.1. Initial Probing (Determine JS Dependency & Obvious Blockers):**
    a.  `discovered_needs_captcha_solver = false`.
    b.  **Attempt cURL:** Fetch page. If fails, note. Analyze for CAPTCHA markers; if found, `discovered_needs_captcha_solver = true`.
    c.  **Attempt Puppeteer (with Stealth):**
        *   Launch Puppeteer with stealth plugins, configured proxy, and UA.
        *   Navigate to URL, wait for `domcontentloaded` or short timeout.
        *   Get page HTML (`puppeteer_html`).
        *   Analyze `puppeteer_html` for CAPTCHA markers; if found, `discovered_needs_captcha_solver = true`.
    d.  **Compare DOMs (if cURL was successful):**
        *   If cURL HTML and `puppeteer_html` are highly similar and cURL response is valid, `tentative_method_is_curl = true`, `html_for_analysis = curl_html`.
        *   Else, `tentative_method_is_curl = false`, `html_for_analysis = puppeteer_html`. (If cURL failed, `tentative_method_is_curl` is false by default).

2.  **C.2. Page Preparation for XPath Discovery (if Puppeteer HTML is used):**
    a.  If `html_for_analysis` is from Puppeteer (i.e., `!tentative_method_is_curl` or if re-discovery is forced for a Puppeteer-known site):
        *   Ensure Puppeteer instance is running (or re-launch if needed, with stealth).
        *   `navigateAndPreparePage()`: Full navigation, waits for network idle, basic interactions (scrolls, mouse moves) to trigger dynamic content.
        *   `html_for_analysis = await page.content()`.
        *   Re-analyze `html_for_analysis` for CAPTCHA markers if not already confirmed. If found, `discovered_needs_captcha_solver = true`.
    b.  (If `tentative_method_is_curl` is true, `html_for_analysis` is already set from cURL).

3.  **C.3. XPath Discovery via LLM & Heuristics:**
    a.  `llm_feedback = []`.
    b.  `article_snippets = extractArticleSnippets(html_for_analysis)`.
    c.  **Loop** up to `MAX_LLM_RETRIES`: (LLM interaction, XPath validation, scoring as before).
        *   ...
        v. If `scored_candidates` not empty, `best_candidate =` highest scoring, `found_xpath = best_candidate.xpath`, break loop.
    d.  Close Puppeteer if launched primarily for discovery and not needed for `html_for_analysis` source.

4.  **C.4. Outcome of Discovery:**
    a.  **If `found_xpath` is identified:**
        i.  Determine `method_to_store`:
            *   If `tentative_method_is_curl` AND `found_xpath` successfully extracts content from `curl_html` (quick re-validation), then `method_to_store = curl`.
            *   Else if `discovered_needs_captcha_solver` is true, then `method_to_store = puppeteer_captcha`.
            *   Else (JS rendering needed, no CAPTCHA detected), `method_to_store = puppeteer_stealth`.
        ii. Create/Update entry in `KnownSitesTable`:
            *   `domain_pattern`, `method: method_to_store`, `xpath_main_content: found_xpath`, timestamps, `failure_count: 0`, **`needs_captcha_solver: discovered_needs_captcha_solver`** (this flag is true if `method_to_store` is `puppeteer_captcha`), `discovered_by_llm: true`, `user_agent_to_use`.
        iii. Save `KnownSitesTable`.
        iv. Proceed to step **D (Content Extraction)** using `method_to_store`, `found_xpath`, and `discovered_needs_captcha_solver`.
    b.  **If no `found_xpath`:** Log failure, save debug HTML, return error. **(END)**

**D. Content Extraction (Post-XPath Identification / For Newly Discovered)**

1.  The method (`current_method`), XPath (`current_xpath`), and CAPTCHA requirement (`current_needs_captcha` which is true if `current_method` is `puppeteer_captcha`) are now known.
2.  **D.2. CAPTCHA Handling (if `current_method` is `puppeteer_captcha`):**
    a.  Integrate with an external CAPTCHA solving service (identify elements, send to API, receive solution, submit).
    b.  If CAPTCHA solving fails, the overall extraction attempt fails.
3.  Execute `current_method` (cURL; or Puppeteer with stealth, and with CAPTCHA solving if `current_method` is `puppeteer_captcha`).
4.  Once page loaded/rendered (and CAPTCHA solved if applicable): Extract content.
5.  **Basic Validation:** Check XPath and content.

**E. Return Data**

1.  Return extracted content, status, messages.

### 7. Key Sub-Modules/Components

*   **`KnownSitesTableManager`**
*   **`PuppeteerController`**:
    *   `launchPuppeteerBrowser()`: Configures and launches Puppeteer instances (always with stealth, accepts proxy).
    *   ... (other functions as before)
*   **`CurlHandler`**
*   **`DomComparator`**
*   **`LLMInterface`**
*   **`ContentScoringEngine`**
*   **`CaptchaSolverIntegration`**
*   **`HtmlAnalyser`**

### 8. Failure Handling & Re-validation

(As previously listed)

### 9. Future Considerations / Advanced Features

(As previously listed)

**Key Changes in this Version (v3):**

*   Removed `puppeteer_basic` as a distinct method. All Puppeteer usage implies stealth.
*   The `method` field in `KnownSitesTable` can be `curl`, `puppeteer_stealth`, or `puppeteer_captcha`.
*   The `needs_captcha_solver` field in `KnownSitesTable` is true if a CAPTCHA was detected. If this is true, the `method` stored will typically be `puppeteer_captcha`.
*   Initial Puppeteer attempt in C.1.c is now explicitly "Puppeteer (with Stealth)".
*   Logic for determining `method_to_store` in C.4.a.i is updated to reflect the new method types.

This makes the specification more streamlined regarding Puppeteer's operational modes.
