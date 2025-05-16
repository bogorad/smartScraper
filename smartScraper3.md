## Universal Web Scraper: Detailed Specification (Revised)

### 1. Goal

To create a robust and adaptive web scraper capable of extracting relevant content from a wide variety of websites, including those with anti-scraping measures. The system should learn from successful scrapes to improve efficiency for known sites.

### 2. Core Principles

*   **Tiered Approach:** Prioritize simpler, faster methods (like cURL) and escalate to more complex, resource-intensive methods (like Puppeteer with LLM-assisted XPath discovery) only when necessary.
*   **Learning & Adaptation:** Store successful scraping configurations (method, XPath, CAPTCHA needs) for known domains to expedite future requests. Re-discover configurations if they become stale.
*   **Proxy Usage:** Employ proxies for all requests to mitigate IP-based blocking and enhance anonymity.
*   **Anti-Bot Evasion:** Incorporate techniques to bypass common anti-bot measures.

### 3. Obstacles Addressed

*   User-Agent checks.
*   Basic IP-based blocking (via proxies).
*   GDPR consent banners (via generic clickers, acknowledging limitations).
*   CAPTCHAs (via integration with external solvers, for both new and known sites).
*   Soft paywalls (basic attempts via plugins/interaction).
*   Dynamic content loading triggered by user interaction (mouse movements, scrolling).
*   Website structure changes breaking XPaths (via re-discovery).
*   Identifying relevant content on unknown pages.

### 4. Internal Data Structure: `KnownSitesTable`

This table (e.g., a JSON file or database) stores configurations for domains where scraping has been successful. Each entry could be keyed by a domain pattern (e.g., `example.com` or `blog.example.com/article/*`).

**Fields per entry:**

*   `domain_pattern`: The URL pattern this configuration applies to.
*   `method`: The determined scraping method (`curl`, `puppeteer_basic`, `puppeteer_stealth`, `puppeteer_captcha`).
*   `xpath_main_content`: The validated XPath to the main relevant content.
*   `last_successful_scrape_timestamp`: Timestamp of the last successful scrape using this config.
*   `failure_count_since_last_success`: Counter for consecutive failures, to trigger re-validation/re-discovery.
*   `site_specific_headers`: (Optional) Any custom HTTP headers required.
*   `user_agent_to_use`: (Optional) A specific User-Agent string if one proved particularly effective.
*   `needs_captcha_solver`: (Boolean) **True if a CAPTCHA was detected during discovery and requires an external solver for this site using the stored method.**
*   `puppeteer_wait_conditions`: (Optional) Specific conditions for Puppeteer to wait for (e.g., selector, network idle duration) if defaults are insufficient.
*   `discovered_by_llm`: (Boolean) True if the XPath was found via the LLM discovery process.

### 5. High-Level Algorithm Flow

1.  **Request Initiation:** Scraper receives a URL and optional parameters (e.g., desired output format: full HTML or content around XPath).
2.  **Proxy & User-Agent Setup:** Select a proxy and User-Agent for the request.
3.  **Known Site Check:** Check if the URL matches a pattern in the `KnownSitesTable`.
    *   If **Known Site & Config Valid:** Use stored configuration (including CAPTCHA handling) to scrape.
    *   If **Known Site & Config Stale/Fails:** Trigger re-discovery.
    *   If **Unknown Site:** Proceed to discovery.
4.  **Unknown Site / Re-Discovery Process:**
    *   Attempt various methods (cURL, Puppeteer) to fetch page content.
    *   Analyze page for CAPTCHAs and JavaScript dependency.
    *   Employ "SmartScraper" logic (LLM + heuristics) to identify the XPath for relevant content and determine if a CAPTCHA solver is needed.
    *   If successful, store the new configuration (including `needs_captcha_solver` status) in `KnownSitesTable`.
5.  **Content Extraction:** Use the determined method, XPath, and CAPTCHA handling to extract content.
6.  **Return Data:** Return extracted content or an error/status message.

### 6. Detailed Algorithm Steps

**A. Proxy & User-Agent Management**

1.  Maintain a pool of proxies (residential/datacenter, rotating).
2.  For each new scraping session (or even request, depending on strategy), select a proxy from the pool.
3.  Maintain a list of current, common User-Agent strings. Rotate these for requests, especially to new sites or if a previous attempt failed.

**B. Known Site Processing**

1.  Normalize the input URL to derive a domain key/match against `domain_pattern` in `KnownSitesTable`.
2.  **If a matching entry is found:**
    a.  Retrieve `method`, `xpath_main_content`, `needs_captcha_solver`, and other configurations.
    b.  Check `failure_count_since_last_success`. If above a threshold, or if `last_successful_scrape_timestamp` is too old, consider the config potentially stale and proceed to step **C (Unknown Site Processing / Re-Discovery)**, passing the old XPath and `needs_captcha_solver` status as hints.
    c.  **CAPTCHA Handling (Known Site):**
        *   If `KnownSitesTable[domain].needs_captcha_solver` is true:
            *   Integrate with an external CAPTCHA solving service (see step **D.2** for details). This must be done *before or during* the main method execution if the CAPTCHA blocks content access.
    d.  **Execute Stored Method:**
        *   If `method` is `curl`: Use cURL with appropriate headers and User-Agent. (Note: CAPTCHA solving is typically not applicable directly with cURL unless it's a token passed in headers/POST data after being solved via a browser context).
        *   If `method` involves `puppeteer`: Launch Puppeteer (basic, stealth). If `needs_captcha_solver` is true, ensure the CAPTCHA solving logic is integrated into the Puppeteer flow.
    e.  **Validate Extraction:**
        *   Attempt to find the element using `xpath_main_content`.
        *   **Success Condition (for now):** XPath exists and the element is not empty.
    f.  **If successful:**
        *   Reset `failure_count_since_last_success` to 0. Update `last_successful_scrape_timestamp`.
        *   Extract content (full HTML or `innerHTML` of the element at `xpath_main_content` based on request arguments).
        *   Return extracted data. **(END)**
    g.  **If stored XPath fails (element not found/empty, or method execution failed despite CAPTCHA attempt):**
        *   Increment `failure_count_since_last_success`.
        *   Save updated `KnownSitesTable`.
        *   Log the failure.
        *   Proceed to step **C (Unknown Site Processing / Re-Discovery)**, passing the failed XPath and `needs_captcha_solver` status as feedback.

**C. Unknown Site Processing / XPath Re-Discovery (SmartScraper Logic Integration)**

1.  **C.1. Initial Probing (Determine JS Dependency & Obvious Blockers):**
    a.  `discovered_needs_captcha_solver = false`.
    b.  **Attempt cURL:**
        *   Fetch page with a standard User-Agent and selected proxy.
        *   If cURL fails (HTTP error, empty response), note this.
        *   Analyze cURL response for obvious CAPTCHA markers. If found, `discovered_needs_captcha_solver = true`.
    c.  **Attempt Basic Puppeteer:**
        *   Launch Puppeteer with minimal configuration.
        *   Navigate to URL, wait for `domcontentloaded` or a short timeout.
        *   Get page HTML.
        *   Analyze Puppeteer response for obvious CAPTCHA markers. If found, `discovered_needs_captcha_solver = true`.
    d.  **Compare DOMs (if cURL was successful):**
        *   Convert cURL HTML and Puppeteer HTML to Markdown. Calculate similarity.
        *   If similarity is high and cURL response seems valid, `tentative_method = curl`, `html_for_analysis = curl_html`.
        *   Else, `tentative_method = puppeteer`, `html_for_analysis` will come from a more advanced Puppeteer attempt.

2.  **C.2. Advanced Puppeteer Attempt (if needed for discovery):**
    a.  If `tentative_method` is `puppeteer` or if re-discovery is forced for a Puppeteer-known site:
        *   Launch Puppeteer using `launchPuppeteerBrowser()` (stealth, plugins).
        *   `navigateAndPreparePage()` (navigation, waits, basic interactions).
        *   `html_for_analysis = await page.content()`.
        *   Re-analyze `html_for_analysis` for CAPTCHA markers if not already confirmed. If found, `discovered_needs_captcha_solver = true`.

3.  **C.3. XPath Discovery via LLM & Heuristics:**
    a.  `llm_feedback = []` (include hints from previous failed attempts if re-discovering).
    b.  `article_snippets = extractArticleSnippets(html_for_analysis)`.
    c.  **Loop** up to `MAX_LLM_RETRIES`:
        i.  `llm_candidate_xpaths = getLlmCandidateXPaths(...)`.
        ii. If LLM call fails/malformed, log, add feedback, `continue` or break.
        iii. `scored_candidates = []`.
        iv. For each `candidate_xpath`:
            1.  `details = queryXPathWithDetails(...)`.
            2.  If element not found, add feedback, continue.
            3.  `score = scoreElement(...)`.
            4.  If `score > 0`, add to `scored_candidates`.
            5.  Else, add feedback about low score/paragraphs.
        v. If `scored_candidates` not empty, `best_candidate =` highest scoring, `found_xpath = best_candidate.xpath`, break loop.
    d.  Close Puppeteer if launched for discovery.

4.  **C.4. Outcome of Discovery:**
    a.  **If `found_xpath` is identified:**
        i.  Determine `method_to_store`: `curl` if viable and `found_xpath` works on `curl_html`, else `puppeteer_stealth` (or `puppeteer_captcha` if `discovered_needs_captcha_solver` is true).
        ii. Create/Update entry in `KnownSitesTable`:
            *   `domain_pattern`, `method: method_to_store`, `xpath_main_content: found_xpath`, timestamps, `failure_count: 0`, **`needs_captcha_solver: discovered_needs_captcha_solver`**, `discovered_by_llm: true`.
        iii. Save `KnownSitesTable`.
        iv. Proceed to step **D (Content Extraction)** using `method_to_store`, `found_xpath`, and `discovered_needs_captcha_solver`.
    b.  **If no `found_xpath`:**
        i.  Log failure, save debug HTML if enabled.
        ii. Notify caller, return error. **(END)**

**D. Content Extraction (Post-XPath Identification / For Newly Discovered)**

1.  The method (`current_method`), XPath (`current_xpath`), and CAPTCHA requirement (`current_needs_captcha`) are now known.
2.  **D.2. CAPTCHA Handling (if `current_needs_captcha` is true):**
    a.  This step is primarily relevant if `current_method` is Puppeteer-based.
    b.  Integrate with an external CAPTCHA solving service:
        *   Identify CAPTCHA elements on the page (e.g., reCAPTCHA iframe, hCaptcha elements).
        *   Send CAPTCHA details (e.g., site key, page URL, image data) to the solver API.
        *   Receive a solution token or instructions.
        *   Automate submission of the token/solution back to the website (e.g., filling a hidden textarea, executing JavaScript callback, clicking submit).
    c.  This may require specific logic per CAPTCHA type and is a complex interaction point. If CAPTCHA solving fails, the overall extraction for this attempt fails.
3.  Execute `current_method` (cURL or Puppeteer). If Puppeteer, ensure CAPTCHA solving (if applicable) is part of its execution flow.
4.  Once page is loaded/rendered (and CAPTCHA solved if applicable):
    a.  Extract content: Full HTML or `innerHTML` at `current_xpath`.
    b.  **Basic Validation:** Check if XPath still exists and content is not empty.

**E. Return Data**

1.  Return the extracted content.
2.  Include status (success/failure) and messages.

### 7. Key Sub-Modules/Components

(As previously listed: `ProxyManager`, `UserAgentManager`, `KnownSitesTableManager`, `PuppeteerController`, `CurlHandler`, `DomComparator`, `LLMInterface`, `ContentScoringEngine`, `CaptchaSolverIntegration`, `HtmlAnalyser`)

### 8. Failure Handling & Re-validation

*   **Stale Configuration Detection:** Track `failure_count_since_last_success`. Force re-discovery on high count or old timestamp.
*   **Proactive Re-validation:** Periodically re-validate a subset of known site configurations.
*   **Debugging:** Logging, `SAVE_HTML_ON_FAILURE`.
*   **LLM Errors:** Retry, fallback, report.

### 9. Future Considerations / Advanced Features

(As previously listed: advanced interactions, ML for direct extraction, visual analysis, diverse content types, granular XPaths).
