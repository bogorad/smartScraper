# SmartScraper: Intelligent Web Content Extractor

## Overview

SmartScraper is a Node.js script designed to intelligently extract the main article content (as raw HTML) from a given web page URL. It addresses the challenge of varying website structures by:

1.  **Attempting extraction using a known method:** If it has previously determined the correct structure (XPath) for the website's domain, it uses that stored XPath.
2.  **Automatically discovering the structure:** If the domain is unknown or the previously stored XPath fails (indicating a potential website redesign), it uses browser automation (Puppeteer) and a Large Language Model (LLM via OpenRouter API) to analyze the page structure, identify the most likely XPath for the main content, and score potential candidates.
3.  **Caching results:** Successfully discovered XPaths are stored locally (in `xpath_storage.json`) mapped to their domain name, speeding up future requests to the same domain.

The goal is to provide a robust way to get the core content block from diverse article-like web pages, minimizing the need for manual XPath creation for every site.

## Features

*   **Automatic XPath Discovery:** Leverages LLMs to find the main content container XPath for unknown domains.
*   **XPath Caching:** Stores successful domain-XPath pairs in a local JSON file (`xpath_storage.json`) for efficient reuse.
*   **Self-Healing:** If a stored XPath fails during extraction, automatically triggers the discovery process to find a potentially updated XPath.
*   **Raw HTML Extraction:** Returns the `innerHTML` of the identified main content element.
*   **Configurable:** Uses environment variables (`.env` file) for API keys, LLM model selection, Puppeteer settings, and debugging.
*   **Robust Error Handling:** Provides informative errors and uses exit codes for scripting integration.
*   **Debug Logging:** Optional verbose logging for troubleshooting.
*   **Failure Artifacts:** Optionally saves the full HTML of a page if XPath discovery fails.

## Workflow

The script follows this logical flow when processing a URL:

1.  **Receive URL:** The script is invoked with a target URL.
2.  **Normalize Domain:** The primary domain name is extracted from the URL (e.g., `https://www.example.com/article/123` -> `example.com`).
3.  **Load Storage:** Reads the `xpath_storage.json` file into memory.
4.  **Check Storage:** Looks up the normalized domain in the loaded storage data.
5.  **Path A: Known XPath Found**
    *   An XPath exists for the domain in storage.
    *   **Attempt Extraction:** Launch Puppeteer, navigate to the URL, and try to extract the `innerHTML` using the stored XPath (`fetchWithKnownXpath` function).
    *   **Extraction Success:** If content is successfully extracted, return the HTML content and exit successfully.
    *   **Extraction Failure:** If the stored XPath doesn't find a valid element (returns null or empty content), log a warning. Assume the site structure may have changed. Proceed to Path B.
6.  **Path B: Unknown Domain or Known XPath Failed**
    *   No XPath exists for the domain, or the stored one failed in Path A.
    *   **Run Discovery & Extraction:** Execute the core LLM-based discovery logic (`findArticleXPathAndExtract` function):
        *   Launch Puppeteer, navigate to the URL, load the full HTML.
        *   Extract text snippets for LLM context.
        *   Iteratively query the LLM for candidate XPaths, providing feedback on failed attempts.
        *   Validate candidate XPaths using Puppeteer (`queryXPathWithDetails`).
        *   Score valid candidates based on heuristics (paragraph count, semantic tags, density, etc.).
        *   Select the highest-scoring valid XPath.
        *   **If a best XPath is found:** Immediately use the *current* Puppeteer page to extract the `innerHTML` using this newly found XPath.
    *   **Discovery Success:**
        *   The `findArticleXPathAndExtract` function returns the `foundXPath` and the `extractedHtml`.
        *   Update the in-memory storage: `storage[domain] = foundXPath`.
        *   Save the updated storage object back to `xpath_storage.json`.
        *   Return the `extractedHtml` and exit successfully.
    *   **Discovery Failure:**
        *   If no suitable XPath can be found after all retries, log an error.
        *   Optionally save the full page HTML to the `failed_html_dumps` directory if `SAVE_HTML_ON_FAILURE` is enabled.
        *   Return an error message and exit with a non-zero status code.

*Note: This workflow ensures Puppeteer is launched at most once per `getContent` call. If discovery is needed, the same browser session is efficiently reused for the final extraction.*

## Technology Stack

*   **Runtime:** Node.js
*   **Browser Automation:** `puppeteer-core` (requires a separate Chromium/Chrome installation)
*   **HTTP Requests:** `axios` (for LLM API calls)
*   **Configuration:** `dotenv` (for loading `.env` files)
*   **LLM API:** OpenRouter.ai (or any OpenAI-compatible API endpoint)

## Prerequisites

*   **Node.js:** Version 16 or higher recommended.
*   **npm:** Node Package Manager (usually comes with Node.js).
*   **Chromium/Chrome:** A compatible version of Chromium or Google Chrome installed and accessible by Puppeteer. The path might need to be configured.
*   **OpenRouter API Key:** An API key from [OpenRouter.ai](https://openrouter.ai/).
*   **LLM Model Access:** Ensure the selected LLM model in your `.env` file is available via your OpenRouter account.

## Installation

1.  Clone or download the `smartScraper.js` script.
2.  Navigate to the script's directory in your terminal.
3.  Install the required Node.js packages:
    ```bash
    npm install dotenv axios puppeteer-core
    ```

## Configuration

Create a file named `.env` in the same directory as the script. Add the following variables:

```dotenv
# --- Required ---
# Your OpenRouter API Key
OPENROUTER_API_KEY=your_openrouter_api_key_here
# The LLM model identifier to use (e.g., openai/gpt-4o, anthropic/claude-3-haiku)
LLM_MODEL=google/gemini-2.0-flash-lite-001

# --- Optional ---
# Path to your Chrome/Chromium executable if not found automatically by Puppeteer
# Example Linux: EXECUTABLE_PATH=/usr/bin/google-chrome-stable
# Example macOS: EXECUTABLE_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
# Example Windows: EXECUTABLE_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
EXECUTABLE_PATH=/usr/lib/chromium/chromium # Or wherever your Chromium/Chrome executable is

# Comma-separated paths to browser extensions to load (optional)
EXTENSION_PATHS="/home/chuck/git/I-Still-Dont-Care-About-Cookies/src,/home/chuck/git/bypass-paywalls-chrome-clean-master,/home/chuck/git/uBOL-home/chromium"

# Enable verbose debug logging (true or false)
DEBUG=false

# Save full HTML to ./failed_html_dumps/ if XPath discovery fails (true or false)
SAVE_HTML_ON_FAILURE=false
```

**Important:** Ensure the `EXECUTABLE_PATH` points to a valid browser installation that `puppeteer-core` can use.

## Usage

Run the script from your terminal, providing the target URL as a command-line argument:
Note: xvfb-run creates a fake x-server so chromium is happy.

```bash
xvfb-run -a node smartScraper.js <URL>
```

**Example:**

```bash
xvfb-run -a node smartScraper.js "https://en.wikipedia.org/wiki/Web_scraping"
```

**Output:**

*   **On Success:** The script will print the raw HTML content of the main article body to standard output (`stdout`) and exit with code `0`. All informational and debug logs go to standard error (`stderr`).
*   **On Failure:** The script will print an error message to standard error (`stderr`) and exit with a non-zero exit code (usually `1`).

## Storage

*   **File:** `xpath_storage.json`
*   **Location:** Same directory as the script.
*   **Format:** A JSON object mapping normalized domain names (keys) to their corresponding discovered XPath strings (values).
    ```json
    {
      "piratewires.com": "//section[contains(@class, 'article_postBody')]",
      "nypost.com": "//article[contains(@class, 'single')]",
      "nytimes.com": "//article",
      "ft.com": "//article[@id='article-body']",
      "usatoday.com": "//article[@class='story primary-content text opinion row']",
      "prospect.org": "//main[@id='maincontent']",
      "unherd.com": "//article",
      "thespectator.com": "//main",
      "realclearmarkets.com": "//article",
      "civitasinstitute.org": "//main",
      "realclearinvestigations.com": "//article",
      "foxnews.com": "//article",
      "washingtontimes.com": "//section[@id='content']",
      "thehill.com": "//div[@class='article__text | body-copy | flow']",
      "apnews.com": "//div[@class='RichTextStoryBody RichTextBody']",
      "newsnationnow.com": "//main",
      "bostonherald.com": "//article[@id='post-5524767']/div[@class='article-content']/div[@class='article-content-wrapper']/div[@class='article-body']",
      "yahoo.com": "//article",
      "foreignaffairs.com": "//*[@class='article-dropcap--inner paywall-content']",
      "city-journal.org": "//div[@id='article-content']",
      "harvardsalient.com": "//article",
      "theamericanconservative.com": "//div[@class='c-blog-post__content s-wysiwyg s-wysiwyg--blog']",
      "theatlantic.com": "//main/article",
      "theglobeandmail.com": "//*[@id='content-gate']",
      "spiked-online.com": "//article",
      "freebeacon.com": "//div[@class='article-content']",
      "nationalpost.com": "//*[@class='story-v2-block-content']",
      "sltrib.com": "//div[@class='article-body-container']",
      "thestar.com": "//*[@class='asset-body']",
      "sfchronicle.com": "//article[@class='rel']",
      "tippinsights.com": "//div[@class='c-content ']",
      "washingtonexaminer.com": "//div[@class='article-paywall']",
      "coolidgereview.com": "//div[@class='blog-item-content e-content']",
      "bloomberg.com": "//div[@class='body-content']",
      "manhattancontrarian.com": "//div[@data-content-field='main-content']//article",
      "commentary.org": "//div[@class='entry-content']",
      "compactmag.com": "//main",
      "esquire.com": "//div[@data-journey-body='longform-article']",
      "realclearworld.com": "//div[@id='article_content']",
      "alexberenson.substack.com": "//div[@class='body markup']",
      "issuesinsights.com": "//div[@class='entry-content']",
      "axios.com": "//div[contains(@class,'col-1-13') and *[contains(@data-schema,'smart-brevity')]]",
      "pjmedia.com": "//section[@class='post-body']",
      "amgreatness.com": "//main//article//div[@class='entry-content relative  dropcap ']",
      "vox.com": "//div[@id='zephr-anchor']",
      "theguardian.com": "//div[@data-gu-name='body']",
      "thefederalist.com": "//main[@id='main']",
      "post-gazette.com": "//div[@class='pgevoke-contentarea-body-text']",
      "time.com": "/html/body/div/main/article",
      "reason.com": "//div[@class='entry-content']",
      "newcriterion.com": "//main",
      "commonplace.org": "//div[contains(@class, 'entry-content')]",
      "universetoday.com": "//div[@class='article-content']",
      "gizmodo.com": "//div[contains(@class,'entry-content')]"
    }
    ```
*   **Management:** The file is automatically created if it doesn't exist. It's read when the script starts processing a URL and updated whenever a new XPath is successfully discovered or an existing one is re-discovered after a failure.

## Error Handling & Robustness

*   **Stored XPath Failure:** Automatically triggers re-discovery.
*   **LLM Retries:** Attempts multiple interactions with the LLM if initial candidates fail validation.
*   **Puppeteer Errors:** Catches errors during browser launch, navigation, and interaction.
*   **Network Errors:** Handles potential errors during LLM API calls.
*   **Invalid URLs:** Checks URL format before processing.
*   **Clear Exit Codes:** Uses `0` for success and `1` for failure.
*   **Failure HTML Dumps:** Optionally saves the full HTML when discovery fails, aiding manual debugging.

## Debugging

To enable verbose logging, set the `DEBUG` variable in your `.env` file to `true`:

```dotenv
DEBUG=true
```

This will print detailed step-by-step logs from Puppeteer interactions, scoring logic, and API calls to `stderr`.

## Potential Improvements

*   **Alternative Storage:** Implement support for more robust storage like SQLite for better scalability and concurrent access handling.
*   **Advanced Domain Normalization:** Handle subdomains more granularly if needed (e.g., treat `blog.example.com` differently from `www.example.com`).
*   **Periodic XPath Validation:** Add a mechanism to proactively check if stored XPaths are still valid over time.
*   **Content Cleaning:** Add options to further process the extracted HTML (e.g., remove script tags, convert to markdown).
*   **Web UI / API:** Wrap the script in a simple web server (e.g., using Express.js) to provide an API endpoint.
*   **Rate Limiting / Politeness:** Implement delays between requests to the same domain.

## License

MIT License
