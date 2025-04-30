# XPath Discovery Script Specification

## 1. Overview

This Node.js script is designed to automatically discover the most appropriate XPath expression for extracting the main article content from a given news or article web page URL. It combines semantic analysis using a Large Language Model (LLM) with structural and statistical analysis performed by directly controlling a Puppeteer browser instance.

The goal is to find an XPath that selects the HTML element (or a minimal set of elements) containing the core narrative, paragraphs, images, and relevant media of an article, while excluding surrounding boilerplate like navigation, sidebars, footers, and comment sections.

## 2. Inputs

The script accepts configuration and input via:

*   **Command-Line Argument:**
    *   The first command-line argument (`process.argv[2]`) is treated as the target URL.
    *   If no command-line argument is provided, it defaults to `https://en.wikipedia.org/wiki/Dark_Enlightenment`.
*   **Environment Variables:**
    *   `OPENROUTER_API_KEY`: API key for accessing the OpenRouter service. (Required)
    *   `LLM_MODEL`: The specific LLM model name to use via OpenRouter (e.g., `openai/gpt-4o`). (Required)
    *   `EXECUTABLE_PATH`: Path to the Chromium/Chrome executable for Puppeteer-core. (Required, defaults to `/usr/lib/chromium/chromium`)
    *   `EXTENSION_PATHS`: Comma-separated string of paths to browser extensions to load. (Optional)
    *   `DEBUG`: Set to `true` to enable verbose debug logging. (Optional)
    *   `SAVE_HTML_ON_FAILURE`: Set to `true` to save the full HTML content of the page to a file if XPath discovery fails. (Optional)

## 3. Outputs

*   **Standard Output (Console):** Extensive logging is provided to track the script's progress, including Puppeteer launch details, navigation status, LLM API calls, candidate XPaths, scoring details, and cleanup steps. Debug logging is controlled by the `DEBUG` environment variable.
*   **Saved HTML Files:** If `SAVE_HTML_ON_FAILURE` is set to `true` and the script fails to find a suitable XPath, the full HTML content of the page will be saved to a file in the `./failed_html_dumps` directory.
*   **Return Value:** The `findArticleXPath` function returns:
    *   A string containing the best-scoring XPath found.
    *   `null` if no suitable XPath is found after processing all candidates.

## 4. Core Logic and Algorithm

The script follows a multi-step process orchestrated by the `findArticleXPath` function:

1.  **Launch Puppeteer Browser:**
    *   **Logic:** Replicates the exact Puppeteer launch configuration found in the user's provided wrapper code, setting `headless: false`. This includes using `puppeteer-core`, specifying `executablePath`, configuring `userDataDir`, applying specific `launchArgs` (including extension loading based on `EXTENSION_PATHS`, with the socks5 proxy argument commented out), and setting a launch timeout.
    *   **Rationale:** Ensures compatibility with the user's specific Chromium environment and extension setup, running the full browser without a visible window. Using a temporary `userDataDir` ensures a clean browser state for each run.
2.  **Navigate and Prepare Page:**
    *   **Logic:** Creates a new page, sets viewport and user-agent, waits for a fixed 3-second delay, navigates to the target URL using `page.goto` with `waitUntil: 'networkidle2'`, waits for a 45-second navigation timeout, performs mouse movement and scrolling, and waits for a fixed 5-second post-navigation delay.
    *   **Rationale:** Replicates the navigation and interaction pattern from the user's wrapper, which might be necessary for the page to load dynamic content or bypass simple bot detection. `networkidle2` waits for network activity to settle. Fixed delays are a simple, albeit sometimes inefficient, way to wait for rendering.
3.  **Get Full HTML:**
    *   **Logic:** Uses `page.content()` to retrieve the full HTML content of the rendered page.
    *   **Rationale:** Provides the LLM with the complete, post-JavaScript-execution HTML structure for analysis.
4.  **Extract Anchor Snippets:**
    *   **Logic:** Uses `page.$$eval()` to find elements matching common text selectors (`p, h2, h3, li, blockquote`), extracts their text content, filters for a minimum length (50 characters), and limits the number of snippets (to 5). This is done efficiently within the browser context.
    *   **Rationale:** Provides the LLM with specific text examples from the likely article body. This helps the LLM ground its analysis and identify relevant sections within the large HTML source.
5.  **Get Candidate XPaths from LLM:**
    *   **Logic:** Calls the OpenRouter API (`/chat/completions`) using the OpenAI Chat API format. Sends the full HTML and anchor snippets in the user message, along with a system message and a detailed prompt instructing the LLM to identify article container XPaths and return them *only* as a JSON array of strings. Uses the configured `LLM_MODEL` and `OPENROUTER_API_KEY`.
    *   **Logic (Parsing):** Includes a specific step to check if the LLM's response content is wrapped in a markdown code block (` ```json ... ``` `) using a regular expression. If detected, it extracts the content inside the block before attempting `JSON.parse()`.
    *   **Rationale:** Leverages the LLM's understanding of web structure and content patterns to generate initial, semantically relevant XPath candidates. The markdown handling makes the script more robust to variations in LLM output formatting.
6.  **Validate and Score Candidates:**
    *   **Logic:** Iterates through the unique candidate XPaths received from the LLM. For each XPath:
        *   Uses `page.evaluate()` with `document.evaluate()` to query the live DOM for elements matching the XPath. This returns a snapshot of matching nodes.
        *   Counts the total number of elements found (`snapshotLength`).
        *   If elements are found, it takes the *first* element node from the snapshot.
        *   *Within the same `page.evaluate` call*, it counts descendant elements of the first matched element for specific tags (`TAGS_TO_COUNT`, including `p` and `UNWANTED_TAGS`) using `element.querySelectorAll()`.
        *   It extracts the tag name, ID, and class of the first matched element.
        *   It returns the total count and the details/descendant counts of the first element back to the Node.js environment.
        *   **Scores the candidate:** Calls the `scoreElement` function with the extracted details, the total count, and the XPath string. The scoring is based on:
            *   A slightly reduced bonus if only one element was found by the XPath (`isSingleElement`).
            *   Points proportional to the number of paragraphs found inside (`paragraphCount`).
            *   Penalty proportional to the ratio of unwanted tags found inside to the *total number of descendant elements* (`unwantedPenaltyRatio`).
            *   Bonus for semantic tags (`<article>`, `<main>`).
            *   Bonus for descriptive IDs or classes.
            *   Penalty based on the complexity of the XPath string (`xpathComplexityPenalty`).
            *   Bonus proportional to text density (`textDensity`).
            *   Penalty proportional to link density (`linkDensityPenalty`).
            *   Bonus for media presence (`mediaPresence`).
        *   Adds the candidate XPath and its score to a list if the score is greater than 0 (meaning it passed the `MIN_PARAGRAPH_THRESHOLD` check within `scoreElement`).
    *   **Rationale:** This is the core validation step. It uses Puppeteer to verify if the LLM's suggested XPath actually works on the live page and quantifies the quality of the matched element(s) based on structural and content heuristics (paragraph density, absence of boilerplate, text/link density, media). Using `document.evaluate` within `page.evaluate` is a robust way to perform XPath queries and subsequent DOM inspection in the browser context, avoiding potential compatibility issues with `page.$$x`. Scoring allows ranking candidates and selecting the best one programmatically. The updated scoring incorporates penalties for overly complex XPaths and refines the unwanted tag penalty basis for potentially more accurate results.
7.  **Select Best XPath:**
    *   **Logic:** Sorts the list of scored candidates in descending order by score.
    *   Selects the XPath of the highest-scoring candidate.
    *   If no candidates passed the scoring threshold (list is empty), returns `null`.
    *   **Rationale:** Chooses the candidate that best meets the defined criteria for an article content container based on the validation and scoring process.
8.  **Cleanup:**
    *   **Logic:** Uses a `finally` block to ensure that the Puppeteer page and browser instances are closed, and the temporary user data directory is removed, regardless of whether the process succeeded or failed.
    *   **Logic (Save HTML):** If `SAVE_HTML_ON_FAILURE` is true and no `bestCandidateXPath` was found, the `saveHtmlOnFailure` function is called to save the fetched `htmlContent` to a file in the `./failed_html_dumps` directory.
    *   **Rationale:** Prevents resource leaks (browser processes, temporary files) which are critical for long-running or frequently executed scripts. Saving HTML on failure provides valuable debugging information.

## 5. Key Design Decisions and Rationale

*   **Hybrid Approach (LLM + Puppeteer):** Combines the LLM's ability to understand semantic structure from HTML text with Puppeteer's ability to interact with and inspect the live, rendered DOM. This is more powerful than either approach alone.
*   **Replicating Wrapper Launch:** Necessary to ensure the script runs in the same browser environment as the user's existing setup, including extensions and specific Chromium versions.
*   **Using `document.evaluate` for XPath:** Chosen over `page.$$x` due to observed compatibility issues with specific Chromium builds when using `puppeteer-core`. `document.evaluate` is a standard browser API, making this approach more portable across different browser versions.
*   **In-Browser Element Details & Counting:** Performing descendant counting (`querySelectorAll`) and attribute extraction within the same `page.evaluate` call that finds the element via `document.evaluate` is efficient and avoids potential issues with passing `ElementHandle` objects back and forth between Node.js and the browser context for subsequent operations.
*   **Multi-Factor Scoring:** A single metric (like just paragraph count) is insufficient. Combining paragraph density, absence of unwanted elements, semantic tags, descriptive attributes, text/link density, media presence, and XPath complexity provides a more nuanced assessment of whether an element is truly the main article container.
*   **Tunable Scoring Weights:** The `SCORE_WEIGHTS` object allows easy adjustment of the importance of different factors, enabling tuning for better performance across various website structures.
*   **Minimum Paragraph Threshold:** Acts as a basic filter to quickly discard elements that clearly do not contain the main body text, regardless of other factors.
*   **Handling LLM Output Variations:** Explicitly checking for and stripping markdown code blocks makes the script more robust to common inconsistencies in LLM responses when strict formatting is requested.
*   **Robust Error Handling and Cleanup:** Essential for production-ready scripts that interact with external processes and resources.
*   **Save HTML on Failure:** Adds a valuable debugging feature by preserving the exact HTML state of the page when the script cannot find a suitable XPath.

## 6. Dependencies

*   `axios`: For making HTTP requests to the LLM API.
*   `puppeteer-core`: For controlling the browser.
*   `dotenv`: For loading environment variables from a `.env` file.
*   `crypto`: Standard Node.js module for hashing (used for filename generation).
*   Standard Node.js modules: `fs`, `os`, `path`.

## 7. Configuration (Environment Variables)

As listed in Section 2. These must be set in the environment or in a `.env` file loaded by `dotenv`.

## 8. Error Handling

*   Checks for missing required environment variables on startup.
*   Includes `try...catch` blocks around major operations (browser launch, navigation, API calls, XPath queries) to catch errors and log them.
*   Specific error messages are logged for different failure points (e.g., navigation timeout, LLM API errors, XPath query errors).
*   The main `findArticleXPath` function returns `null` on failure.
*   Global `uncaughtException` and `unhandledRejection` handlers are present (inherited from the wrapper code structure) for fatal errors.

## 9. Cleanup

*   A `finally` block in `findArticleXPath` ensures that `browser.close()` and the removal of the temporary `userDataDir` are attempted after the main logic completes or if an error occurs.
*   `elementHandle.dispose()` is implicitly handled as `queryXPathWithDetails` no longer returns handles.
*   If enabled via `SAVE_HTML_ON_FAILURE`, the HTML content is saved to disk on failure during the cleanup phase.

This specification provides a comprehensive description of the script's functionality, implementation details, and the reasoning behind its design choices.
